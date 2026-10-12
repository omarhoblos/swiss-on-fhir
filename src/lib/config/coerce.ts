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

import { err, ok, type Result } from './types';

/**
 * Coercion for values arriving from the runtime config file.
 *
 * Everything in static/swiss-env.json is a STRING, including booleans --
 * the config rendering step only produces strings, and the template is honest
 * about that so this layer has exactly one input type to handle. The Angular app's
 * `parseDotEnvBoolean` existed to paper over "boolean in dev, string in prod"
 * and had three bugs this replaces:
 *
 *   1. It returned `undefined` (falsy) for any input that was not exactly
 *      "true" or "false", so a typo silently became false.
 *   2. It rejected "TRUE", "1", "yes".
 *   3. It could not tell an unsubstituted "${ENABLE_HTTPS}" placeholder from
 *      a genuine value -- which is exactly the failure mode when the
 *      container's entrypoint does not render the file.
 */

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off', '']);

/**
 * The longest value any setting may have.
 *
 * Nothing Swiss is configured with comes close: a long scope list is a few
 * hundred characters. The limit exists so a runaway value -- a pasted file, a
 * hostile runtime config -- is rejected with a reason instead of being stored,
 * rendered and sent on every request. The container enforces the same number
 * at startup (docker-entrypoint.d/40-swiss-config.sh).
 */
export const MAX_VALUE_LENGTH = 4096;

/**
 * Matches a `${VAR}` left over from config/env.template.json. The rendering
 * step turns an unset variable into "", never into its placeholder, so a
 * literal `${VAR}` means the file was never rendered at all.
 */
const UNSUBSTITUTED = /^\$\{[A-Z0-9_]+\}$/;

function placeholderError(raw: string): string {
  return `value is still the literal placeholder ${raw}, so swiss-env.json was never rendered from .env and none of its settings were applied. The container's startup script that renders it (docker-entrypoint.d/40-swiss-config.sh) did not run: check that the image's entrypoint has not been overridden and that swiss-env.json is not replaced by a mounted or copied file`;
}

export function isUnsubstitutedPlaceholder(input: unknown): boolean {
  return typeof input === 'string' && UNSUBSTITUTED.test(input.trim());
}

export function coerceBoolean(input: unknown): Result<boolean> {
  if (typeof input === 'boolean') return ok(input);
  if (typeof input !== 'string') return err(`expected a boolean, got ${typeof input}`);

  const raw = input.trim();
  if (isUnsubstitutedPlaceholder(raw)) return err(placeholderError(raw));

  const value = raw.toLowerCase();
  if (TRUE_VALUES.has(value)) return ok(true);
  if (FALSE_VALUES.has(value)) return ok(false);
  return err(`expected true or false, got "${input}"`);
}

/**
 * Strips one layer of symmetric surrounding quotes.
 *
 * `docker run --env-file` is not a shell: it does not strip quotes, so
 * `LOGOUT_URI='http://...'` in a .env arrives with literal apostrophes as
 * part of the value. The committed .env did exactly this, so anyone who
 * copied it as a template hits this. Applies to any key, so it lives here
 * rather than in a single field's parser.
 */
export function stripSurroundingQuotes(input: string): string {
  const value = input.trim();
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return value.slice(1, -1).trim();
  }
  return value;
}

export function coerceString(input: unknown): Result<string> {
  if (typeof input === 'boolean' || typeof input === 'number') return ok(String(input));
  if (typeof input !== 'string') return err(`expected a string, got ${typeof input}`);
  if (input.length > MAX_VALUE_LENGTH) {
    // The value itself is left out: it is what is too long to show.
    return err(`value is ${input.length} characters long; the limit is ${MAX_VALUE_LENGTH}`);
  }
  // A line break would split a `.env` export into extra settings, and no
  // setting has a use for one. Refused with a reason, as the container's
  // entrypoint refuses it, rather than stripped.
  if ([...input].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) {
    return err('value contains a line break or other control character');
  }
  const raw = stripSurroundingQuotes(input);
  if (isUnsubstitutedPlaceholder(raw)) return err(placeholderError(raw));
  return ok(raw);
}

/**
 * Coerces a URL, returning the normalised origin+path with any trailing
 * slash removed so comparisons elsewhere are stable.
 *
 * Deliberately lenient: a plaintext scheme is a warning from `validate.ts`,
 * not a rejection here, and normalisation is reported by
 * `describeUrlNormalization` below. A tool whose job is diagnosing a
 * misconfigured server has to be able to load a suspicious value and then
 * tell you what is suspicious about it.
 */
export function coerceUrl(input: unknown): Result<string> {
  const asString = coerceString(input);
  if (!asString.ok) return asString;

  const raw = asString.value;
  if (raw === '') return ok('');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return err(
      raw.includes('://')
        ? `"${raw}" is not a valid URL`
        : `"${raw}" is not an absolute URL -- include a scheme, e.g. https://${raw}`
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return err(`"${raw}" must use http or https, not ${url.protocol.replace(':', '')}`);
  }
  if (url.search || url.hash) {
    return err(`"${raw}" should be a base URL with no query string or fragment`);
  }

  // Keep the path (some FHIR servers live at /fhir or /baseR4) but drop a
  // trailing slash so `https://x/fhir` and `https://x/fhir/` compare equal.
  const path = url.pathname.replace(/\/+$/, '');
  return ok(`${url.origin}${path}`);
}

/**
 * Describes what `coerceUrl` changed, or null if it changed nothing.
 *
 * This has to be called where the RAW value is still available, because
 * `new URL()` silently lowercases the host -- so by the time a value reaches
 * cross-field validation the original casing is already gone.
 *
 * It matters because host-case normalisation is the single most common cause
 * of a failed OIDC issuer-match: you configure `https://IdP.Example`, we (and
 * every OIDC library) normalise it to lowercase, your server's discovery
 * document declares the mixed-case form, and the comparison fails. Surfacing
 * it here means Diagnostics' issuer failure arrives already explained.
 */
export function describeUrlNormalization(raw: unknown, normalized: string): string | null {
  if (typeof raw !== 'string' || normalized === '') return null;

  const trimmed = stripSurroundingQuotes(raw);
  if (trimmed === normalized) return null;

  const notes: string[] = [];

  let original: URL;
  try {
    original = new URL(trimmed);
  } catch {
    return null;
  }

  // Compare the authority as the user typed it, before the URL constructor
  // got to it.
  const typedAuthority = trimmed.slice(trimmed.indexOf('://') + 3).split(/[/?#]/)[0] ?? '';
  if (typedAuthority !== typedAuthority.toLowerCase()) {
    notes.push(
      `the host was lowercased to "${original.host}" (URL parsing always does this, and it is the usual reason an OIDC issuer-match check fails)`
    );
  }

  if (/\/+$/.test(trimmed) && !/\/+$/.test(normalized)) {
    notes.push('a trailing slash was removed');
  }

  if (notes.length === 0) return null;
  return `"${trimmed}" was normalised to "${normalized}": ${notes.join('; ')}.`;
}

/** Normalises whitespace in a space-delimited scope string. */
export function coerceScopes(input: unknown): Result<string> {
  // A pasted scope list may span lines: whitespace of any kind separates
  // scopes, so it is collapsed before the control-character check.
  const asString = coerceString(typeof input === 'string' ? input.replace(/\s+/g, ' ') : input);
  if (!asString.ok) return asString;
  return ok(asString.value.split(/\s+/).filter(Boolean).join(' '));
}

export function coerceEnum<T extends string>(allowed: readonly T[]): (input: unknown) => Result<T> {
  return (input: unknown) => {
    const asString = coerceString(input);
    if (!asString.ok) return asString as Result<T>;
    const value = asString.value as T;
    if (allowed.includes(value)) return ok(value);
    return err(`expected one of ${allowed.join(', ')}, got "${asString.value}"`);
  };
}
