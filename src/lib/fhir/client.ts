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

import { probe } from '$lib/http/probe';
import { exchangeLog } from '$lib/http/log.svelte';
import type { HttpExchange } from '$lib/http/exchange';
import { buildFhirUrl, nextPageUrl } from './url';
import { originOf } from '$lib/url';
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
  /**
   * The FHIR base the access token was issued for, when that is known and
   * may differ from `base`. The token is only attached to this origin.
   * Defaults to `base`.
   */
  tokenBase?: string;
  headers?: Record<string, string>;
  body?: string;
  accessToken?: string | null;
  /** Attach the bearer token. Off means send the request unauthenticated. */
  authorize: boolean;
  /**
   * Also attach it to an origin other than the FHIR base's. Off by default:
   * a typed absolute URL or a Bundle.link[next] the server supplied can point
   * anywhere, and sending the token there hands it to that origin.
   */
  allowCrossOriginToken?: boolean;
  signal?: AbortSignal;
}

/** Whether the bearer token belongs on a request to `url`. */
export function tokenBelongsOn(url: URL, base: string, allowCrossOrigin: boolean): boolean {
  if (allowCrossOrigin) return true;
  const baseOrigin = originOf(base);
  return baseOrigin !== null && url.origin === baseOrigin;
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
  /** Set when the token was deliberately not sent: the origin it was kept from. */
  tokenWithheld?: string;
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
  const wantsToken = options.authorize && Boolean(options.accessToken);
  const belongs = tokenBelongsOn(
    url,
    options.tokenBase ?? options.base,
    options.allowCrossOriginToken ?? false
  );
  const tokenWithheld = wantsToken && !belongs ? url.origin : undefined;
  if (wantsToken && belongs) {
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
    tokenWithheld,
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
  return nextPageUrl(body);
}

/** Counts entries in a Bundle, for a result summary. */
export function describeResult(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const resource = json as Record<string, unknown>;

  // Counts what is in `entry`, and nothing else. `Bundle.total` is not used:
  // it counts only search matches, so a search with _include or _revinclude
  // returns more entries than its total, and comparing the two read as
  // "2 of 1 entries".
  if (resource.resourceType === 'Bundle') {
    const entries = Array.isArray(resource.entry) ? resource.entry.length : 0;
    return `Bundle returned with ${entries} total ${entries === 1 ? 'entry' : 'entries'}`;
  }

  if (typeof resource.resourceType === 'string') {
    const id = typeof resource.id === 'string' ? `/${resource.id}` : '';
    return `${resource.resourceType}${id}`;
  }

  return null;
}
