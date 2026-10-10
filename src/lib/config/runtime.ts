/*
 Copyright 2021 Omar Hoblos

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

import { describeUrlNormalization, isUnsubstitutedPlaceholder } from './coerce';
import { FIELDS_BY_KEY, REMOVED_KEYS } from './fields';
import type { AppConfig, ConfigIssue, ConfigLayer } from './types';

/**
 * Loads the runtime configuration file.
 *
 * This is the ONLY deployer-facing config input. `.env` is rendered into
 * static/swiss-env.json -- by the container entrypoint at startup, or by
 * scripts/render-config.mjs for local dev -- and fetched here at boot.
 *
 * It is JSON fetched at runtime rather than a <script> that assigns
 * window.env (which is what Swiss 2.x did) for one decisive reason: failure
 * mode. A syntax error in a JS config file is an unrecoverable white screen,
 * and the v2 file already had a stray comma that only worked by accident. A
 * JSON parse error is catchable, so we can render a "your config is broken,
 * here is where to fix it" screen instead -- which matters a great deal for a
 * tool whose whole purpose is diagnosing misconfiguration.
 */

/** v2 named these differently; accept both so an old hand-edited file loads. */
const KEY_ALIASES: Record<string, keyof AppConfig> = {
  fhirEndpointUri: 'fhirBaseUrl',
  issuer: 'authIssuer'
};

export interface RuntimeLoadResult {
  /** Parsed values that matched a known field, before layering. */
  layer: ConfigLayer;
  /** Per-field coercion failures, removed-key notes, unknown-key notes. */
  issues: ConfigIssue[];
  /**
   * Set when the file could not be loaded or parsed at all. The app renders
   * a config-error screen and still lets the user reach /config.
   */
  loadError: string | null;
  /**
   * The `frame-ancestors` sources the server sent with the file: who may
   * show Swiss in a frame. The container renders them from FRAME_ANCESTORS
   * into a response header, which nothing in the browser can change, so this
   * is shown, never edited. Null when the response carried none, as from the
   * development server; undefined when the file could not be fetched.
   */
  frameAncestors?: string[] | null;
}

/**
 * The sources of the `frame-ancestors` directive in a Content-Security-Policy
 * header, or null when there is none. Several policies arrive joined by
 * commas; the first that names frame-ancestors is used.
 */
export function frameAncestorsOf(csp: string | null): string[] | null {
  if (!csp) return null;
  for (const directive of csp.split(/[;,]/)) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (name?.toLowerCase() === 'frame-ancestors') return sources;
  }
  return null;
}

/**
 * Served at the root, NOT under a directory.
 *
 * This must not collide with a route name. It originally lived at
 * /config/env.json, which created a `config/` directory in the served root;
 * nginx's `try_files $uri $uri/` then matched that directory for the /config
 * route and returned 301 -> /config/ -> 403, making the Configuration page
 * unreachable in the container while working fine under the dev server.
 */
export const RUNTIME_CONFIG_PATH = '/swiss-env.json';

/**
 * The rendered file is six short strings, well under a kilobyte. Anything
 * near this size is not a Swiss config, and parsing it would only produce a
 * page of "not a recognised setting" notes.
 */
export const MAX_RUNTIME_CONFIG_LENGTH = 65536;

/** Unknown keys are reported, but not without limit. */
const MAX_UNKNOWN_KEY_NOTES = 20;

export async function loadRuntimeConfig(
  fetchImpl: typeof fetch = fetch,
  path: string = RUNTIME_CONFIG_PATH
): Promise<RuntimeLoadResult> {
  let response: Response;
  try {
    // no-store matters: the nginx config also sets it. Without it the browser
    // caches swiss-env.json and "edit .env, restart the container, refresh" -- the
    // workflow the README promises -- silently keeps the old values.
    response = await fetchImpl(path, { cache: 'no-store' });
  } catch (cause) {
    return {
      layer: {},
      issues: [],
      loadError: `Could not fetch ${path}: ${cause instanceof Error ? cause.message : String(cause)}`
    };
  }

  // Read off the same response the settings come in, whatever happens to
  // its body: nginx sends the security headers on every location. Guarded,
  // because nothing here may throw out of load() and stop the app booting.
  const frameAncestors = frameAncestorsOf(response.headers?.get('content-security-policy') ?? null);
  return { ...(await readBody(response, path)), frameAncestors };
}

async function readBody(response: Response, path: string): Promise<RuntimeLoadResult> {
  if (!response.ok) {
    return {
      layer: {},
      issues: [],
      loadError: `${path} returned HTTP ${response.status} ${response.statusText}. The container may not have rendered it at startup.`
    };
  }

  let text: string;
  try {
    // Reading the body can fail after the headers arrived (a dropped
    // connection, an aborted navigation). Unguarded, that rejection left
    // `load()` and the app showed the error page instead of running on
    // defaults with /config reachable.
    text = await response.text();
  } catch (cause) {
    return {
      layer: {},
      issues: [],
      loadError: `Could not read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`
    };
  }

  if (text.length > MAX_RUNTIME_CONFIG_LENGTH) {
    return {
      layer: {},
      issues: [],
      loadError: `${path} is ${text.length} characters long; the limit is ${MAX_RUNTIME_CONFIG_LENGTH}. It does not look like a Swiss configuration file.`
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    // A very common shape of this failure: the SPA fallback served
    // index.html because the file is missing, so we get HTML, not JSON.
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text);
    return {
      layer: {},
      issues: [],
      loadError: looksLikeHtml
        ? `${path} returned an HTML page rather than JSON. The file is probably missing, so the SPA fallback served index.html instead.`
        : `${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
    };
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      layer: {},
      issues: [],
      loadError: `${path} must contain a JSON object, got ${Array.isArray(raw) ? 'an array' : typeof raw}.`
    };
  }

  return parseRuntimeObject(raw as Record<string, unknown>, path);
}

export function parseRuntimeObject(
  raw: Record<string, unknown>,
  path = RUNTIME_CONFIG_PATH
): RuntimeLoadResult {
  const layer: ConfigLayer = {};
  const issues: ConfigIssue[] = [];
  let unknownKeys = 0;

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    // JSON Schema pointer, if someone adds one to the template.
    if (rawKey === '$schema') continue;

    // Own properties only, so a "constructor" key in the file cannot pick up
    // an inherited function as its alias or note.
    const own = (table: Record<string, unknown>) =>
      Object.prototype.hasOwnProperty.call(table, rawKey);
    const alias = own(KEY_ALIASES) ? KEY_ALIASES[rawKey] : undefined;
    const removedNote = own(REMOVED_KEYS) ? REMOVED_KEYS[rawKey] : undefined;
    const key = (alias ?? rawKey) as keyof AppConfig;
    const spec = FIELDS_BY_KEY.get(key);

    if (!spec) {
      // Unknown keys warn and never fail. Every existing deployment has a
      // .env carrying the four keys removed in 3.0, and a hard failure on
      // upgrade would take all of them down.
      const note = removedNote;
      // The template still renders retired variables, so a deployment that
      // sets one hears it can go. Unset ones render as "" -- stay quiet then,
      // or every deployment would be told about settings it never used. A
      // leftover placeholder means the file was never rendered, reported elsewhere.
      if (note && (rawValue === '' || isUnsubstitutedPlaceholder(rawValue))) continue;
      unknownKeys += 1;
      if (unknownKeys > MAX_UNKNOWN_KEY_NOTES) continue;
      issues.push({
        key: null,
        severity: 'info',
        ignoredKey: rawKey,
        message: note ?? `"${rawKey}" is not a recognised setting and was ignored.`
      });
      continue;
    }

    // An in-app-only setting has no business being in the runtime file, but
    // accept it rather than fail -- it is harmless and possibly deliberate.
    const parsed = spec.parse(rawValue);
    if (!parsed.ok) {
      issues.push({
        key,
        severity: 'error',
        message: `${spec.label} (${spec.envKey ?? spec.key}): ${parsed.error}`
      });
      continue;
    }

    if (alias) {
      issues.push({
        key,
        severity: 'info',
        ignoredKey: rawKey,
        message: `"${rawKey}" was read as "${key}". ${removedNote ?? ''}`.trim()
      });
    }

    // Report URL normalisation while we still have the raw value. Once
    // coerceUrl has run `new URL()` the host casing is gone, and host-case
    // normalisation is the usual cause of a failed issuer-match check.
    if (spec.kind === 'url' && typeof parsed.value === 'string') {
      const note = describeUrlNormalization(rawValue, parsed.value);
      if (note) {
        issues.push({
          key,
          severity: key === 'authIssuer' ? 'warning' : 'info',
          message: `${spec.label}: ${note}`
        });
      }
    }

    // Per-field unset-vs-empty. Rendering writes every unset variable as "",
    // so without this an unset FHIRENDPOINT_URI would clobber the default
    // with an empty string, while an intentionally empty CLIENT_SECRET must
    // be preserved as "no secret".
    const isEmpty = parsed.value === '';
    if (isEmpty && spec.emptyMeansUnset) continue;

    Object.assign(layer, { [key]: parsed.value });
  }

  if (unknownKeys > MAX_UNKNOWN_KEY_NOTES) {
    const more = unknownKeys - MAX_UNKNOWN_KEY_NOTES;
    issues.push({
      key: null,
      severity: 'info',
      message: `...and ${more} more unrecognised ${more === 1 ? 'setting was' : 'settings were'} ignored.`
    });
  }

  void path;
  return { layer, issues, loadError: null };
}
