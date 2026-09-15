import { err, ok, type Result } from './types';

/**
 * Coercion for values arriving from the runtime config file.
 *
 * Everything in static/swiss-env.json is a STRING, including booleans --
 * envsubst can only produce strings, and the template is honest about that so
 * this layer has exactly one input type to handle. The Angular app's
 * `parseDotEnvBoolean` existed to paper over "boolean in dev, string in prod"
 * and had three bugs this replaces:
 *
 *   1. It returned `undefined` (falsy) for any input that was not exactly
 *      "true" or "false", so a typo silently became false.
 *   2. It rejected "TRUE", "1", "yes".
 *   3. It could not tell an unsubstituted "${ENABLE_HTTPS}" placeholder from
 *      a genuine value -- which is exactly the failure mode when the
 *      container's envsubst step does not run.
 */

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off', '']);

/** Matches a `${VAR}` that envsubst should have replaced and did not. */
const UNSUBSTITUTED = /^\$\{[A-Z0-9_]+\}$/;

function placeholderError(raw: string): string {
  return `value is still the literal placeholder ${raw} -- the container's envsubst step did not run, so .env was never applied`;
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
 * document declares the mixed-case form, and the comparison fails. That is
 * exactly why `skipIssuerCheck` exists in this project.
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
  const asString = coerceString(input);
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
