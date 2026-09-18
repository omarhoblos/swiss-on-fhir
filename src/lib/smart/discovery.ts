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

import { probeJson } from '$lib/http/probe';
import type { HttpExchange } from '$lib/http/exchange';
import { httpUrl } from '$lib/url';
import {
  ENDPOINT_KEYS,
  type DiscoverySource,
  type EndpointConflict,
  type EndpointKey,
  type ResolvedEndpoints,
  type SmartConfiguration
} from './types';

/**
 * SMART / OIDC discovery.
 *
 * The Angular app had none of this: it passed the configured issuer to the
 * OIDC library and let it fetch openid-configuration, so
 * .well-known/smart-configuration was never read and SMART capabilities were
 * never inspected.
 */

/**
 * Compares two URLs for practical equivalence.
 *
 * `trivially-different` covers differences that cannot change behaviour:
 * host case (the URL parser normalises it anyway), an explicit default port,
 * and a trailing slash. PATH case is significant and never normalised --
 * `/Auth` and `/auth` are genuinely different resources on most servers.
 */
export function urlEquivalence(
  a: string,
  b: string
): 'identical' | 'trivially-different' | 'different' {
  if (a === b) return 'identical';

  let ua: URL;
  let ub: URL;
  try {
    ua = new URL(a);
    ub = new URL(b);
  } catch {
    return 'different';
  }

  const canonical = (u: URL) => {
    const port =
      (u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')
        ? ''
        : u.port;
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.hostname.toLowerCase()}${port ? ':' + port : ''}${path}${u.search}`;
  };

  return canonical(ua) === canonical(ub) ? 'trivially-different' : 'different';
}

/**
 * Precedence, highest first.
 *
 * smart-configuration outranks openid-configuration because in SMART the
 * FHIR server is authoritative about which authorization server protects it.
 * `manual` and `ehr-launch-iss` outrank both: overriding is the entire point
 * of a test tool, and in an EHR launch the `iss` the EHR gave us is
 * definitionally correct while a configured issuer is a guess.
 */
const PRECEDENCE: DiscoverySource[] = [
  'manual',
  'ehr-launch-iss',
  'smart-configuration',
  'openid-configuration',
  'capability-statement'
];

export type DiscoveryDocuments = Partial<Record<DiscoverySource, Record<string, unknown>>>;

/**
 * Every value any document supplied for a key, in precedence order.
 *
 * `mergeEndpoints` keeps only the winner, which is right for a display of
 * what Swiss resolved, but it discards a working value when a
 * higher-precedence document advertises a broken one. Callers that can retry
 * want the whole list.
 */
export function advertisedValues(docs: DiscoveryDocuments, key: EndpointKey): string[] {
  return PRECEDENCE.map((source) => docs[source]?.[key]).filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
}

/** An advertised endpoint that is not an http(s) URL, and so was never resolved. */
export interface RejectedEndpoint {
  key: EndpointKey;
  source: DiscoverySource;
  value: string;
}

export function mergeEndpoints(docs: DiscoveryDocuments): {
  resolved: ResolvedEndpoints;
  conflicts: EndpointConflict[];
  rejected: RejectedEndpoint[];
} {
  const resolved: ResolvedEndpoints = {};
  const conflicts: EndpointConflict[] = [];
  const rejected: RejectedEndpoint[] = [];

  for (const key of ENDPOINT_KEYS) {
    const supplied = PRECEDENCE.map((source) => ({ source, value: docs[source]?.[key] })).filter(
      (c): c is { source: DiscoverySource; value: string } =>
        typeof c.value === 'string' && c.value.length > 0
    );
    // Every resolved endpoint is something Swiss will navigate to, link to,
    // or send a token to. Anything that is not http(s) -- a `javascript:`
    // URL from a hostile discovery document, say -- is dropped here, once,
    // rather than trusted to be caught at each of those sinks.
    const candidates = supplied.filter((c) => {
      if (httpUrl(c.value)) return true;
      rejected.push({ key, source: c.source, value: c.value });
      return false;
    });

    const winner = candidates[0];
    if (!winner) continue;

    resolved[key] = { value: winner.value, source: winner.source };

    const disagreeing = candidates
      .slice(1)
      .map((other) => ({ other, eq: urlEquivalence(other.value, winner.value) }))
      .filter(({ eq }) => eq !== 'identical');

    if (disagreeing.length > 0) {
      conflicts.push({
        key,
        chosen: winner,
        others: disagreeing.map(({ other }) => other),
        // If every difference is cosmetic, say so rather than alarming.
        severity: disagreeing.every(({ eq }) => eq === 'trivially-different') ? 'info' : 'warn'
      });
    }
  }

  return { resolved, conflicts, rejected };
}

/**
 * Normalises a FHIR base URL before appending a well-known path.
 *
 * Strips a trailing slash and a trailing `/metadata`, which users paste
 * surprisingly often because it is the URL they were testing in a browser.
 */
export function normaliseFhirBase(input: string): string {
  return input
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/metadata$/i, '');
}

export interface DiscoveryFetch {
  document?: Record<string, unknown>;
  exchange: HttpExchange;
  url: string;
}

export async function fetchSmartConfiguration(
  fhirBaseUrl: string,
  fetchImpl?: typeof fetch
): Promise<DiscoveryFetch> {
  const url = `${normaliseFhirBase(fhirBaseUrl)}/.well-known/smart-configuration`;
  const result = await probeJson(url, {
    label: 'SMART configuration',
    headers: { Accept: 'application/json' },
    fetchImpl
  });
  return {
    document: asObject(result.json),
    exchange: result.exchange,
    url
  };
}

/**
 * Some servers host smart-configuration at the host root rather than the
 * FHIR base. Not conformant, but common enough to be worth a second look --
 * and reporting *which* URL answered is itself useful.
 */
export async function fetchSmartConfigurationAtRoot(
  fhirBaseUrl: string,
  fetchImpl?: typeof fetch
): Promise<DiscoveryFetch | null> {
  let origin: string;
  try {
    origin = new URL(fhirBaseUrl).origin;
  } catch {
    return null;
  }
  if (normaliseFhirBase(fhirBaseUrl) === origin) return null;

  const url = `${origin}/.well-known/smart-configuration`;
  const result = await probeJson(url, {
    label: 'SMART configuration (host root)',
    headers: { Accept: 'application/json' },
    fetchImpl
  });
  return { document: asObject(result.json), exchange: result.exchange, url };
}

export async function fetchOpenidConfiguration(
  authIssuer: string,
  fetchImpl?: typeof fetch
): Promise<DiscoveryFetch> {
  const url = `${authIssuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const result = await probeJson(url, {
    label: 'OpenID configuration',
    headers: { Accept: 'application/json' },
    fetchImpl
  });
  return { document: asObject(result.json), exchange: result.exchange, url };
}

/** The SMART 1.0 CapabilityStatement OAuth-URIs extension. */
export const OAUTH_URIS_EXTENSION =
  'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris';

export async function fetchCapabilityOauthUris(
  fhirBaseUrl: string,
  fetchImpl?: typeof fetch
): Promise<DiscoveryFetch> {
  const url = `${normaliseFhirBase(fhirBaseUrl)}/metadata?_summary=true`;
  const result = await probeJson(url, {
    label: 'CapabilityStatement',
    headers: { Accept: 'application/fhir+json' },
    fetchImpl
  });
  return {
    document: result.json ? extractOauthUris(result.json) : undefined,
    exchange: result.exchange,
    url
  };
}

/** Pulls the oauth-uris sub-extensions into a discovery-document shape. */
export function extractOauthUris(
  capabilityStatement: unknown
): Record<string, unknown> | undefined {
  const cs = asObject(capabilityStatement);
  if (!cs) return undefined;

  const rest = Array.isArray(cs.rest) ? cs.rest : [];
  for (const entry of rest) {
    const security = asObject(asObject(entry)?.security);
    const extensions = Array.isArray(security?.extension) ? security.extension : [];
    for (const ext of extensions) {
      const e = asObject(ext);
      if (e?.url !== OAUTH_URIS_EXTENSION) continue;

      const out: Record<string, unknown> = {};
      const inner = Array.isArray(e.extension) ? e.extension : [];
      // Sub-extension names map onto the openid-configuration keys.
      const map: Record<string, EndpointKey> = {
        authorize: 'authorization_endpoint',
        token: 'token_endpoint',
        register: 'registration_endpoint',
        manage: 'management_endpoint',
        introspect: 'introspection_endpoint',
        revoke: 'revocation_endpoint'
      };
      for (const sub of inner) {
        const s = asObject(sub);
        const name = typeof s?.url === 'string' ? s.url : '';
        const key = map[name];
        if (key && typeof s?.valueUri === 'string') out[key] = s.valueUri;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Reads capabilities from either spelling.
 *
 * SMART 2.0 uses `capabilities`; SMART 1.0 used `smart_capabilities`. Accept
 * both, since the tool targets both versions.
 */
export function readCapabilities(doc: SmartConfiguration | undefined): string[] | null {
  if (!doc) return null;
  const v2 = doc.capabilities;
  if (Array.isArray(v2)) return v2.filter((c): c is string => typeof c === 'string');
  const v1 = doc.smart_capabilities;
  if (Array.isArray(v1)) return v1.filter((c): c is string => typeof c === 'string');
  return null;
}
