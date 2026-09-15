import { describeUrlNormalization } from './coerce';
import { FIELDS_BY_KEY, REMOVED_KEYS } from './fields';
import type { AppConfig, ConfigIssue, ConfigLayer } from './types';

/**
 * Loads the runtime configuration file.
 *
 * This is the ONLY deployer-facing config input. `.env` is rendered into
 * static/config/env.json -- by the container entrypoint at startup, or by
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
}

export const RUNTIME_CONFIG_PATH = '/config/env.json';

export async function loadRuntimeConfig(
  fetchImpl: typeof fetch = fetch,
  path: string = RUNTIME_CONFIG_PATH
): Promise<RuntimeLoadResult> {
  let response: Response;
  try {
    // no-store matters: the nginx config also sets it. Without it the browser
    // caches env.json and "edit .env, restart the container, refresh" -- the
    // workflow the README promises -- silently keeps the old values.
    response = await fetchImpl(path, { cache: 'no-store' });
  } catch (cause) {
    return {
      layer: {},
      issues: [],
      loadError: `Could not fetch ${path}: ${cause instanceof Error ? cause.message : String(cause)}`
    };
  }

  if (!response.ok) {
    return {
      layer: {},
      issues: [],
      loadError: `${path} returned HTTP ${response.status} ${response.statusText}. The container may not have rendered it at startup.`
    };
  }

  const text = await response.text();

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

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    // JSON Schema pointer, if someone adds one to the template.
    if (rawKey === '$schema') continue;

    const key = (KEY_ALIASES[rawKey] ?? rawKey) as keyof AppConfig;
    const spec = FIELDS_BY_KEY.get(key);

    if (!spec) {
      // Unknown keys warn and never fail. Every existing deployment has a
      // .env carrying the four keys removed in 3.0, and a hard failure on
      // upgrade would take all of them down.
      const note = REMOVED_KEYS[rawKey];
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

    if (KEY_ALIASES[rawKey]) {
      issues.push({
        key,
        severity: 'info',
        ignoredKey: rawKey,
        message: `"${rawKey}" was read as "${key}". ${REMOVED_KEYS[rawKey] ?? ''}`.trim()
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

    // Per-field unset-vs-empty. envsubst renders every unset variable as "",
    // so without this an unset FHIRENDPOINT_URI would clobber the default
    // with an empty string, while an intentionally empty CLIENT_SECRET must
    // be preserved as "no secret".
    const isEmpty = parsed.value === '';
    if (isEmpty && spec.emptyMeansUnset) continue;

    Object.assign(layer, { [key]: parsed.value });
  }

  void path;
  return { layer, issues, loadError: null };
}
