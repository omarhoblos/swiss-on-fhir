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
import { isSecretHeader, type HttpExchange } from '$lib/http/exchange';
import { buildFhirUrl, nextPageUrl } from './url';
import { originOf } from '$lib/url';
import { isOperationOutcome, parseIssues, type OperationOutcomeIssue } from './operation-outcome';
import { FHIR_MIME, isXmlResponse, readFhirXml, type BodyFormat, type FhirXml } from './xml';

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
  /** The format the body is in, for its Content-Type. JSON when not given. */
  bodyFormat?: BodyFormat;
  /** The format to ask for in Accept. JSON when not given. */
  accept?: BodyFormat;
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
  /** Read body, when the response was XML. */
  xml?: FhirXml;
  text?: string;
  status: number | null;
  ok: boolean;
  issues: OperationOutcomeIssue[];
  /** From Bundle.link[relation=next]. */
  nextPage: string | null;
  durationMs: number;
  /** Set when the token was deliberately not sent: the origin it was kept from. */
  tokenWithheld?: string;
  /** The user's credential headers deliberately not sent, and the origin they were kept from. */
  credentialsWithheld?: { origin: string; headers: string[] };
}

export async function fhirRequest(options: FhirRequestOptions): Promise<FhirResponse> {
  const url = buildFhirUrl(options.base, options.query);

  const belongs = tokenBelongsOn(
    url,
    options.tokenBase ?? options.base,
    options.allowCrossOriginToken ?? false
  );

  // A credential the user added -- a Basic Authorization, an X-Api-Key --
  // follows the bearer token's rule. Without it, a Bundle.link[next] that a
  // server points at another host would collect them on the next click.
  const userHeaders = Object.entries(options.headers ?? {});
  const withheld = belongs ? [] : userHeaders.filter(([name]) => isSecretHeader(name));
  const headers: Record<string, string> = Object.fromEntries(
    userHeaders.filter(([name]) => belongs || !isSecretHeader(name))
  );

  // The Angular client set no Accept header at all, so servers fell back
  // to whatever their default representation was. A user-supplied Accept
  // wins, under any capitalisation: set beside it, fetch would join the two.
  if (!hasHeader(headers, 'accept')) headers.Accept = FHIR_MIME[options.accept ?? 'json'];

  if (options.body && !hasHeader(headers, 'content-type')) {
    headers['Content-Type'] = FHIR_MIME[options.bodyFormat ?? 'json'];
  }

  // Applied last so an explicit user-supplied Authorization header is not
  // silently overwritten -- the old form let the toggle win without saying so.
  const wantsToken = options.authorize && Boolean(options.accessToken);
  const tokenWithheld = wantsToken && !belongs ? url.origin : undefined;
  if (wantsToken && belongs) {
    if (!hasHeader(headers, 'authorization'))
      headers.Authorization = `Bearer ${options.accessToken}`;
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
  const contentType = exchange.response?.headers?.['content-type'] ?? '';
  // DOMParser is the browser's: the unit tests run without one.
  const xml =
    json === undefined &&
    text &&
    typeof DOMParser !== 'undefined' &&
    isXmlResponse(contentType, text)
      ? readFhirXml(text)
      : undefined;
  // The XML outline has the JSON shape, so issues and paging read the same.
  const resource = json ?? xml?.outline ?? undefined;
  const issues = isOperationOutcome(resource) ? parseIssues(resource) : [];

  return {
    tokenWithheld,
    credentialsWithheld:
      withheld.length > 0
        ? { origin: url.origin, headers: withheld.map(([name]) => name) }
        : undefined,
    exchange,
    json,
    xml,
    text,
    status,
    ok: status !== null && status >= 200 && status < 300,
    issues,
    nextPage: extractNextPage(resource),
    durationMs: exchange.durationMs
  };
}

/** Whether a header is set, under any capitalisation. */
export function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((h) => h.toLowerCase() === name);
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
