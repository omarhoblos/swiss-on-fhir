import { probe } from '$lib/http/probe';
import { exchangeLog } from '$lib/http/log.svelte';
import type { HttpExchange } from '$lib/http/exchange';
import { buildFhirUrl } from './url';
import { isOperationOutcome, parseIssues, type OperationOutcomeIssue } from './operation-outcome';

/**
 * The FHIR request layer.
 *
 * A full REST client, not the GET-only service the Angular app had -- which
 * requested `patient/*.write` scope and then had no way to exercise it.
 */

export type FhirMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const READ_ONLY_METHODS: FhirMethod[] = ['GET'];

export interface FhirRequestOptions {
  method: FhirMethod;
  /** Relative to the FHIR base, or an absolute URL. */
  query: string;
  base: string;
  headers?: Record<string, string>;
  body?: string;
  accessToken?: string | null;
  /** Attach the bearer token. Off means send the request unauthenticated. */
  authorize: boolean;
  signal?: AbortSignal;
}

export interface FhirResponse {
  exchange: HttpExchange;
  /** Parsed body, when the response was JSON. */
  json?: unknown;
  text?: string;
  status: number | null;
  ok: boolean;
  issues: OperationOutcomeIssue[];
  /** From Bundle.link[relation=next]. */
  nextPage: string | null;
  durationMs: number;
}

export async function fhirRequest(options: FhirRequestOptions): Promise<FhirResponse> {
  const url = buildFhirUrl(options.base, options.query);

  const headers: Record<string, string> = {
    // The Angular client set no Accept header at all, so servers fell back
    // to whatever their default representation was.
    Accept: 'application/fhir+json',
    ...options.headers
  };

  if (options.body && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/fhir+json';
  }

  // Applied last so an explicit user-supplied Authorization header is not
  // silently overwritten -- the old form let the toggle win without saying so.
  if (options.authorize && options.accessToken) {
    const alreadySet = Object.keys(headers).some((h) => h.toLowerCase() === 'authorization');
    if (!alreadySet) headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const { exchange, json, text } = await probe(url.toString(), {
    label: `${options.method} ${url.pathname}${url.search}`,
    method: options.method,
    headers,
    body: options.body,
    signal: options.signal
  });

  exchangeLog.record(exchange);

  const status = exchange.response?.status ?? null;
  const issues = isOperationOutcome(json) ? parseIssues(json) : [];

  return {
    exchange,
    json,
    text,
    status,
    ok: status !== null && status >= 200 && status < 300,
    issues,
    nextPage: extractNextPage(json),
    durationMs: exchange.durationMs
  };
}

function extractNextPage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  if ((body as { resourceType?: unknown }).resourceType !== 'Bundle') return null;
  const links = (body as { link?: unknown }).link;
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    const l = link as { relation?: unknown; url?: unknown };
    if (l.relation === 'next' && typeof l.url === 'string') return l.url;
  }
  return null;
}

/** Counts entries in a Bundle, for a result summary. */
export function describeResult(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const resource = json as Record<string, unknown>;

  if (resource.resourceType === 'Bundle') {
    const entries = Array.isArray(resource.entry) ? resource.entry.length : 0;
    const total = typeof resource.total === 'number' ? resource.total : null;
    const types = Array.isArray(resource.entry)
      ? [
          ...new Set(
            resource.entry
              .map((e) => (e as { resource?: { resourceType?: unknown } }).resource?.resourceType)
              .filter((t): t is string => typeof t === 'string')
          )
        ]
      : [];
    const typeNote = types.length > 0 ? ` (${types.sort().join(', ')})` : '';
    return total !== null && total !== entries
      ? `Bundle with ${entries} of ${total} entries${typeNote}`
      : `Bundle with ${entries} ${entries === 1 ? 'entry' : 'entries'}${typeNote}`;
  }

  if (typeof resource.resourceType === 'string') {
    const id = typeof resource.id === 'string' ? `/${resource.id}` : '';
    return `${resource.resourceType}${id}`;
  }

  return null;
}
