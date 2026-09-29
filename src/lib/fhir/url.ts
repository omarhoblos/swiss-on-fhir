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
 * Builds a FHIR request URL from whatever the user typed.
 *
 * Replaces the Angular heuristic, which was:
 *
 *   ['http','https'].some(w => query.startsWith(w)) || query?.match(/^\d/)
 *     ? query
 *     : `${environment.fhirEndpointUri}${query}`
 *
 * The `/^\d/` branch meant "a query starting with a digit is used verbatim",
 * which was almost certainly accidental -- `123` is not a URL, and a query
 * beginning with a digit is more likely a typo than an absolute reference.
 * Note also that `startsWith('http')` matched anything beginning with those
 * four letters, including a relative path like `httpbin/Patient`.
 */

export class FhirUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FhirUrlError';
  }
}

export function isAbsoluteUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

/**
 * An empty query means the base itself, which is where a transaction or
 * batch Bundle is POSTed. Whether an empty query may be sent at all is the
 * caller's decision: it is meaningless for a GET.
 */
export function buildFhirUrl(base: string, input: string): URL {
  return requireHttp(resolveFhirUrl(base, input), input);
}

/**
 * A request target must be http(s), whatever it was built from.
 *
 * `new URL(relative, base)` ignores the base when the "relative" part carries
 * its own scheme, so a query of `javascript:alert(1)` or a Bundle.link[next]
 * of `data:...` resolved to exactly that. Nothing fetches those today, but the
 * result is also shown and linked, so the gate sits where the URL is made.
 */
function requireHttp(url: URL, input: string): URL {
  if (url.protocol === 'http:' || url.protocol === 'https:') return url;
  throw new FhirUrlError(
    `"${input.trim()}" is not an http(s) URL, so Swiss will not send a request to it.`
  );
}

function resolveFhirUrl(base: string, input: string): URL {
  const query = input.trim();

  if (isAbsoluteUrl(query)) {
    try {
      return new URL(query);
    } catch {
      throw new FhirUrlError(`"${query}" is not a valid URL.`);
    }
  }

  if (!base) {
    throw new FhirUrlError(
      'No FHIR base URL is configured, so a relative query cannot be resolved.'
    );
  }

  if (!query) {
    try {
      return new URL(base.replace(/\/+$/, ''));
    } catch {
      throw new FhirUrlError(`The FHIR base "${base}" is not a valid URL.`);
    }
  }

  // Ensure exactly one slash between base and path, without letting a
  // leading slash on the query reset to the origin (which would drop a base
  // path like /fhir or /baseR4).
  const normalisedBase = `${base.replace(/\/+$/, '')}/`;
  const relative = query.replace(/^\/+/, '');

  try {
    return new URL(relative, normalisedBase);
  } catch {
    throw new FhirUrlError(`"${input}" could not be resolved against ${base}.`);
  }
}

/** Follows Bundle.link[relation=next] for pagination. */
export function nextPageUrl(bundle: unknown): string | null {
  if (!bundle || typeof bundle !== 'object') return null;
  const links = (bundle as { link?: unknown }).link;
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    const l = link as { relation?: unknown; url?: unknown };
    if (l.relation === 'next' && typeof l.url === 'string' && isHttpOrRelative(l.url)) {
      return l.url;
    }
  }
  return null;
}

/**
 * True for a relative reference or an http(s) URL. The link is server text;
 * resolving it against a placeholder base is what tells a relative
 * `Patient?page=2` apart from `javascript:...` without guessing at syntax.
 */
function isHttpOrRelative(value: string): boolean {
  try {
    const { protocol } = new URL(value, 'http://relative.invalid/');
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Quick queries for the patient in the launch context. */
export function patientReadQuery(patientId: string): string {
  return `Patient/${encodeURIComponent(patientId)}`;
}

export function patientEverythingQuery(patientId: string): string {
  return `Patient/${encodeURIComponent(patientId)}/$everything`;
}

export function patientWithEobQuery(patientId: string): string {
  return `Patient?_id=${encodeURIComponent(patientId)}&_revinclude:iterate=ExplanationOfBenefit:patient`;
}
