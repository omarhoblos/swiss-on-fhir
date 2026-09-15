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

export function buildFhirUrl(base: string, input: string): URL {
  const query = input.trim();
  if (!query) throw new FhirUrlError('The query is empty.');

  if (isAbsoluteUrl(query)) return new URL(query);

  if (!base) {
    throw new FhirUrlError(
      'No FHIR base URL is configured, so a relative query cannot be resolved.'
    );
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
    if (l.relation === 'next' && typeof l.url === 'string') return l.url;
  }
  return null;
}

/** The two canned queries carried over from the Angular app. */
export function patientEverythingQuery(patientId: string): string {
  return `Patient/${patientId}/$everything`;
}

export function patientWithEobQuery(patientId: string): string {
  return `Patient?_id=${encodeURIComponent(patientId)}&_revinclude:iterate=ExplanationOfBenefit:patient`;
}
