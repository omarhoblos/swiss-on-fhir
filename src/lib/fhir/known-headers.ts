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
 * The request headers the FHIR console knows about, and what their values
 * look like.
 *
 * This is help, not a gate. Any name can still be typed, any value can still
 * be sent, and a value that does not look right only earns a note: sending a
 * malformed `If-Match` to see what the server does with it is a fair test.
 * What `fetch` itself refuses is a different matter, and stays with
 * `headerProblem` in `$lib/http/headers`.
 *
 * Nothing here is a header the browser forbids a page to set (Cookie, Host,
 * Origin, ...): offering one would only produce a header that silently never
 * leaves the browser.
 */

export interface Suggestion {
  value: string;
  description?: string;
}

/**
 * How the value box behaves for a header.
 *
 * - `text`: a value box, with suggestions when there are any.
 * - `authorization`: a scheme, then username and password, a token, or the raw value.
 * - `http-date`: a value box with a date picker that writes an HTTP-date.
 * - `etag`: an entity tag, as FHIR sends a version: `W/"3"`.
 * - `request-id`: a value box with a button that generates a UUID.
 */
export type HeaderKind = 'text' | 'authorization' | 'http-date' | 'etag' | 'request-id';

export interface KnownHeader {
  name: string;
  description: string;
  kind: HeaderKind;
  suggestions?: Suggestion[];
  placeholder?: string;
}

export const KNOWN_HEADERS: readonly KnownHeader[] = [
  {
    name: 'Accept',
    description: 'The formats you will take the response in.',
    kind: 'text',
    suggestions: [
      { value: 'application/fhir+json', description: 'FHIR JSON' },
      { value: 'application/fhir+xml', description: 'FHIR XML' },
      {
        value: 'application/fhir+json; fhirVersion=4.0',
        description: 'FHIR JSON, asking for a specific FHIR version'
      },
      { value: 'application/json', description: 'Plain JSON' }
    ]
  },
  {
    name: 'Accept-Language',
    description: 'The languages you prefer for human-readable text.',
    kind: 'text',
    placeholder: 'en-US, en;q=0.8'
  },
  {
    name: 'Authorization',
    description: 'Credentials for the server. Replaces the session’s bearer token on this request.',
    kind: 'authorization'
  },
  {
    name: 'Cache-Control',
    description: 'Asks caches between you and the server not to answer from a stored copy.',
    kind: 'text',
    suggestions: [
      { value: 'no-cache', description: 'Revalidate with the server before using a stored copy' },
      { value: 'no-store', description: 'Do not store the request or the response' }
    ]
  },
  {
    name: 'Content-Type',
    description: 'The format of the request body.',
    kind: 'text',
    suggestions: [
      { value: 'application/fhir+json', description: 'FHIR JSON' },
      { value: 'application/fhir+xml', description: 'FHIR XML' },
      { value: 'application/json-patch+json', description: 'JSON Patch, for PATCH' }
    ]
  },
  {
    name: 'If-Match',
    description: 'Only update or delete if the resource is still at this version.',
    kind: 'etag',
    placeholder: 'W/"3"'
  },
  {
    name: 'If-Modified-Since',
    description: 'Only return the resource if it changed after this time.',
    kind: 'http-date',
    placeholder: 'Fri, 09 Oct 2026 16:30:00 GMT'
  },
  {
    name: 'If-None-Exist',
    description: 'Conditional create: only create if this search finds nothing.',
    kind: 'text',
    placeholder: 'identifier=http://example.org|123'
  },
  {
    name: 'If-None-Match',
    description: 'Only return the resource if its version differs; * makes a PUT create-only.',
    kind: 'etag',
    placeholder: 'W/"3"',
    suggestions: [{ value: '*', description: 'Any version: the request fails if it exists' }]
  },
  {
    name: 'Prefer',
    description: 'How you would like the server to respond or to handle the request.',
    kind: 'text',
    suggestions: [
      { value: 'return=minimal', description: 'No body after a create or update' },
      {
        value: 'return=representation',
        description: 'The stored resource after a create or update'
      },
      {
        value: 'return=OperationOutcome',
        description: 'An OperationOutcome after a create or update'
      },
      { value: 'handling=strict', description: 'Reject unknown or unsupported search parameters' },
      { value: 'handling=lenient', description: 'Ignore unknown or unsupported search parameters' },
      { value: 'respond-async', description: 'Asynchronous request pattern, as bulk export uses' }
    ]
  },
  {
    name: 'X-Request-Id',
    description: 'An identifier for this request, to find it in the server’s logs.',
    kind: 'request-id'
  }
];

const BY_NAME = new Map(KNOWN_HEADERS.map((h) => [h.name.toLowerCase(), h]));

/** The known header with this name, ignoring case, or undefined. */
export function knownHeader(name: string): KnownHeader | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

export function isAuthorization(name: string): boolean {
  return knownHeader(name)?.kind === 'authorization';
}

export type AuthScheme = 'Basic' | 'Bearer' | 'Other';
export const AUTH_SCHEMES: readonly AuthScheme[] = ['Basic', 'Bearer', 'Other'];

export interface AuthFields {
  scheme: AuthScheme;
  username: string;
  password: string;
  token: string;
}

export function emptyAuth(): AuthFields {
  return { scheme: 'Basic', username: '', password: '', token: '' };
}

/**
 * RFC 7617 Basic credentials: `user:pass`, as UTF-8, in base64.
 *
 * `btoa` alone throws on anything outside Latin-1 and would mis-encode what
 * it does take, so the string goes through TextEncoder first.
 */
export function encodeBasic(username: string, password: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(`${username}:${password}`)) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
}

/** The username and password in Basic credentials, or null if they do not decode. */
export function decodeBasic(encoded: string): { username: string; password: string } | null {
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const colon = text.indexOf(':');
    if (colon < 0) return null;
    return { username: text.slice(0, colon), password: text.slice(colon + 1) };
  } catch {
    return null;
  }
}

/** A username Basic cannot carry as typed, or null. It is still encoded and sent. */
export function basicProblem(username: string): string | null {
  return username.includes(':')
    ? 'A Basic username cannot contain a colon: the server will split the credentials at the first one.'
    : null;
}

/** The Authorization value the fields describe, or '' when they describe nothing. */
export function authorizationValue(auth: AuthFields, raw: string): string {
  switch (auth.scheme) {
    case 'Basic':
      return auth.username || auth.password ? encodeBasic(auth.username, auth.password) : '';
    case 'Bearer':
      return auth.token.trim() ? `Bearer ${auth.token.trim()}` : '';
    default:
      return raw;
  }
}

/**
 * Reads an Authorization value back into fields: Basic credentials are
 * decoded, a Bearer token is lifted out, anything else is kept as typed.
 */
export function parseAuthorization(value: string): AuthFields {
  const auth = emptyAuth();
  const basic = /^Basic\s+(\S+)$/i.exec(value.trim())?.[1];
  if (basic) {
    const decoded = decodeBasic(basic);
    if (decoded) return { ...auth, scheme: 'Basic', ...decoded };
  }
  const bearer = /^Bearer\s+(\S.*)$/i.exec(value.trim())?.[1];
  if (bearer) return { ...auth, scheme: 'Bearer', token: bearer };
  return { ...auth, scheme: 'Other' };
}

/**
 * A `datetime-local` value (local time) as an RFC 9110 HTTP-date, or '' if it
 * is not a date.
 */
export function toHttpDate(local: string): string {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? '' : date.toUTCString();
}

const HTTP_DATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const ENTITY_TAG = /(W\/)?"[^"]*"/;
const ENTITY_TAGS = new RegExp(`^(\\*|${ENTITY_TAG.source}(\\s*,\\s*${ENTITY_TAG.source})*)$`);

/**
 * A note about a value that does not look like what the header expects, or
 * null. Never a reason not to send it.
 */
export function valueHint(name: string, value: string): string | null {
  const known = knownHeader(name);
  const v = value.trim();
  if (!known || v === '') return null;
  if (known.kind === 'http-date' && !HTTP_DATE.test(v)) {
    return `Not an HTTP-date (like ${known.placeholder}). The server may ignore it.`;
  }
  if (known.kind === 'etag' && !ENTITY_TAGS.test(v)) {
    return 'Not an entity tag. FHIR sends a version as W/"3", with the quotes.';
  }
  if (known.name === 'If-None-Exist' && /^([A-Za-z]+)?\?/.test(v)) {
    return 'If-None-Exist takes only the search parameters, without a resource type or "?".';
  }
  return null;
}
