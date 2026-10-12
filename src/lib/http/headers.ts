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
 * Validation for request headers the user types.
 *
 * `fetch` throws a TypeError for a header it cannot send, before anything
 * reaches the network. The probe cannot tell that apart from a network
 * failure, so a header name with a space in it was reported as a likely CORS
 * problem on the server -- a wrong diagnosis from a diagnostic tool. Checking
 * the rows first means the mistake is named where it was made.
 */

/** RFC 9110 section 5.1: a field name is a `token`. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function isValidHeaderName(name: string): boolean {
  return TOKEN.test(name);
}

/**
 * RFC 9110 section 5.5 forbids CR, LF and NUL in a field value. They are
 * also what header injection is made of, so they are refused rather than
 * stripped.
 */
export function isValidHeaderValue(value: string): boolean {
  return !/[\r\n\0]/.test(value) && isByteString(value);
}

/**
 * Header values are byte strings: `fetch` throws on any character above
 * U+00FF, so an emoji in a token never reaches the network and used to be
 * reported as a CORS problem.
 */
function isByteString(value: string): boolean {
  return ![...value].some((c) => c.charCodeAt(0) > 0xff);
}

/**
 * Names the Fetch standard does not let a page set. `fetch` does not throw
 * on them; it drops them without a word, so the request goes out without
 * the header the user asked for.
 */
const FORBIDDEN = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via'
]);

export function isForbiddenHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return FORBIDDEN.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-');
}

/** Why a header row cannot be sent, or null when it can. */
export function headerProblem(name: string, value: string): string | null {
  if (!isValidHeaderName(name)) {
    return 'Not a valid header name: use letters, digits and hyphens, with no spaces or colon.';
  }
  if (isForbiddenHeaderName(name)) {
    return `Browsers do not let a page set ${name}; the browser would drop it without a word.`;
  }
  if (/[\r\n\0]/.test(value)) return 'Header values cannot contain line breaks.';
  if (!isByteString(value)) {
    return 'Header values can only hold Latin-1 characters; fetch refuses emoji and most non-Latin scripts.';
  }
  return null;
}

/**
 * A value that will be sent, but perhaps not as meant: characters outside
 * ASCII go out as single Latin-1 bytes, not UTF-8, and most servers read
 * header values as ASCII.
 */
export function headerValueNote(value: string): string | null {
  return [...value].some((c) => c.charCodeAt(0) > 0x7f)
    ? 'Characters outside ASCII are sent as single Latin-1 bytes, not UTF-8, and the server may read them differently.'
    : null;
}
