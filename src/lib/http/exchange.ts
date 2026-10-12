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

/**
 * A recorded HTTP request/response pair.
 *
 * Every network call Swiss makes goes through the probe and produces one of
 * these. For a diagnostic tool the raw exchange IS the deliverable -- it is
 * what you paste into a bug report when your server does something strange --
 * so this is a first-class model rather than a debug log line.
 */

export type ExchangeOutcome =
  | 'ok'
  | 'http-error'
  | 'network-or-cors'
  | 'timeout'
  | 'invalid-json'
  | 'bad-content-type'
  /** Never sent: we knew the browser would refuse it. */
  | 'blocked-precondition'
  /**
   * Stopped from this side before a response arrived: the Diagnostics Stop
   * button, the FHIR console's Cancel, or a request superseded by a newer
   * one. Says nothing about the server.
   */
  | 'aborted';

export type NetworkCause =
  | 'cors-missing-acao'
  | 'cors-preflight'
  | 'mixed-content'
  | 'dns-or-refused'
  | 'tls'
  | 'private-network'
  | 'insecure-context'
  | 'timeout'
  | 'unknown';

export interface NetworkDiagnosis {
  likelyCause: NetworkCause;
  /**
   * `certain` is reserved for preconditions we checked ourselves (mixed
   * content, insecure context). Anything inferred from a fetch rejection is
   * at best `likely`, because the browser deliberately withholds the reason.
   */
  confidence: 'certain' | 'likely' | 'guess';
  evidence: string[];
  remediationIds: string[];
}

export interface HttpExchange {
  id: string;
  label: string;
  startedAt: number;
  durationMs: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: string;
    /** `opaque` means a no-cors probe: reachable, but unreadable. */
    type: string;
    /** Headers the server did not expose to us via CORS. */
    unreadableHeaders?: string[];
  };
  outcome: ExchangeOutcome;
  diagnosis?: NetworkDiagnosis;
  /** Which fields were masked in this record. Keeps an export honest. */
  redactions: string[];
}

/**
 * Header names that carry a credential. The fixed three are the standard
 * ones; the pattern catches what users type into the FHIR console, such as
 * X-Api-Key or Ocp-Apim-Subscription-Key, which would otherwise be persisted
 * verbatim.
 */
const SECRET_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);
const SECRET_HEADER_PATTERN = /token|secret|password|api[-_]?key|subscription[-_]?key/i;

/**
 * A header that carries a credential: redacted in the log, sent only to the
 * FHIR base's origin like the bearer token, and kept in storage for an hour.
 */
export function isSecretHeader(name: string): boolean {
  return SECRET_HEADERS.has(name.toLowerCase()) || SECRET_HEADER_PATTERN.test(name);
}
const SECRET_BODY_PARAMS = [
  'client_secret',
  'code_verifier',
  'refresh_token',
  'code',
  'assertion',
  'client_assertion',
  // Revocation and introspection send the live token as `token`.
  'token',
  'subject_token',
  'actor_token'
];
/** Keys redacted anywhere in a JSON response body, however deeply nested. */
const SECRET_JSON_KEYS = new Set(['access_token', 'refresh_token', 'id_token', 'client_secret']);

export const REDACTED = '«redacted»';

/**
 * Masks credentials in a copy of an exchange.
 *
 * On by default (config.redactSecrets), which is what makes "copy the
 * diagnostics report" safe to paste into a GitHub issue. The `redactions`
 * list names what was masked so the export is not silently lossy.
 */
export function redactExchange(exchange: HttpExchange): HttpExchange {
  const redactions: string[] = [];

  const headers = redactHeaders(exchange.request.headers, redactions, 'request');
  const body = exchange.request.body
    ? redactFormBody(exchange.request.body, redactions)
    : undefined;

  const response = exchange.response
    ? {
        ...exchange.response,
        headers: redactHeaders(exchange.response.headers, redactions, 'response'),
        body: exchange.response.body
          ? redactResponseBody(exchange.response.body, redactions)
          : undefined
      }
    : undefined;

  return {
    ...exchange,
    request: { ...exchange.request, headers, body },
    response,
    redactions: [...new Set([...exchange.redactions, ...redactions])]
  };
}

function redactHeaders(
  headers: Record<string, string>,
  redactions: string[],
  side: string
): Record<string, string> {
  // fromEntries throughout this file, never `out[name] = value`: the names
  // are typed by the user or sent by a server, and assigning `__proto__`
  // sets the prototype instead of a property, dropping the entry.
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      if (isSecretHeader(name)) {
        redactions.push(`${side} header ${name}`);
        return [name, REDACTED];
      }
      return [name, value];
    })
  );
}

function redactFormBody(body: string, redactions: string[]): string {
  // Token requests are form-encoded, so parse rather than regex.
  if (!body.includes('=')) return body;
  try {
    const params = new URLSearchParams(body);
    let touched = false;
    for (const name of SECRET_BODY_PARAMS) {
      if (params.has(name)) {
        params.set(name, REDACTED);
        redactions.push(`request body ${name}`);
        touched = true;
      }
    }
    return touched ? params.toString() : body;
  } catch {
    return body;
  }
}

/** What a response body becomes when it cannot be shown to be free of secrets. */
export const UNCHECKED_BODY = '«redacted: nested too deeply to check for secrets»';

function redactResponseBody(body: string, redactions: string[]): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON. A token endpoint answering form-encoded is non-conforming,
    // but its tokens are just as live.
    return redactFormResponse(body, redactions);
  }
  if (!parsed || typeof parsed !== 'object') return body;
  const touched = new Set<string>();
  let scrubbed: unknown;
  try {
    scrubbed = redactJsonValue(parsed, touched);
  } catch {
    // Too deep to walk without exhausting the stack. Failing closed: the
    // body used to be kept as it came, tokens and all, and written to disk.
    redactions.push('response body (too deeply nested to check)');
    return UNCHECKED_BODY;
  }
  if (touched.size === 0) return body;
  for (const name of touched) redactions.push(`response body ${name}`);
  return JSON.stringify(scrubbed, null, 2);
}

function redactFormResponse(body: string, redactions: string[]): string {
  if (!body.includes('=')) return body;
  const params = new URLSearchParams(body.trim());
  const found = [...SECRET_JSON_KEYS].filter((name) => params.has(name));
  if (found.length === 0) return body;
  for (const name of found) {
    params.set(name, REDACTED);
    redactions.push(`response body ${name}`);
  }
  return params.toString();
}

/**
 * Walks a parsed body and masks credential-named keys at any depth. A token
 * response has them at the top level, but a FHIR server's error, a wrapped
 * response, or an array of them can carry the same keys further down.
 */
function redactJsonValue(value: unknown, touched: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, touched));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, inner]) => {
      if (SECRET_JSON_KEYS.has(key) && typeof inner === 'string') {
        touched.add(key);
        return [key, REDACTED];
      }
      return [key, redactJsonValue(inner, touched)];
    })
  );
}

/**
 * A copy-pasteable reproduction.
 *
 * This is the single most useful affordance for a CORS failure: the browser
 * will not tell JavaScript why a request was blocked, but curl will show
 * whether Access-Control-Allow-Origin comes back.
 */
export function toCurl(exchange: HttpExchange, pageOrigin: string): string {
  // Every interpolated value is shell-quoted. A server-issued token, a header
  // value, or a Bundle.link[next] URL containing a quote would otherwise
  // break out of the quotes and run as shell text when pasted.
  const sq = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  // The method is our own enum, never server text; it stays bare.
  const parts = [`curl -i -X ${exchange.request.method}`];
  parts.push(`  -H ${sq(`Origin: ${pageOrigin}`)}`);
  for (const [name, value] of Object.entries(exchange.request.headers)) {
    parts.push(`  -H ${sq(`${name}: ${value}`)}`);
  }
  if (exchange.request.body) {
    parts.push(`  --data-raw ${sq(exchange.request.body)}`);
  }
  parts.push(`  ${sq(exchange.request.url)}`);
  return parts.join(' \\\n');
}

export function headersToObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers);
}

/**
 * Drops entries whose id has already been seen, keeping the first (newest).
 *
 * This runs where the in-memory buffer meets the restored one, because that
 * is the only place two id namespaces can collide -- and it has to stay even
 * though `nextId` is now unique per page view. Records written by earlier
 * builds are already on disk containing repeated ids, and the drawer keys its
 * {#each} by id, so without this those users keep hitting
 * `each_key_duplicate` and the drawer keeps refusing to open until they
 * clear site storage by hand.
 */
export function dedupeById(entries: HttpExchange[]): HttpExchange[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}
