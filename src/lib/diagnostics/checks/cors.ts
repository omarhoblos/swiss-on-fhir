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
import { toCurl } from '$lib/http/exchange';
import { remediation, remediations } from '../remediation';
import { result, type Check } from '../types';

/**
 * The CORS checks people actually need.
 *
 * We cannot send a bare OPTIONS with fetch, and we cannot read a preflight
 * response at all. But we can learn a great deal from deliberate, harmless
 * requests -- and a browser-based tool that gives up on CORS is giving up on
 * the single most common failure it exists to diagnose.
 */

function curlAction(exchange: Parameters<typeof toCurl>[0], origin: string | null) {
  return {
    kind: 'copy' as const,
    label: 'Copy an equivalent curl command',
    value: toCurl(exchange, origin ?? 'http://localhost:4200')
  };
}

function openAction(url: string) {
  return {
    // The single best CORS diagnostic available: if it loads in a tab but
    // not here, it is definitively CORS and not connectivity.
    kind: 'open-url' as const,
    label: 'Open this URL in a new tab',
    value: url
  };
}

const tokenEndpointCors: Check = {
  id: 'cors.token-endpoint',
  title: 'Token endpoint is reachable and CORS-enabled',
  group: 'cors',
  async run(ctx) {
    const endpoint = ctx.endpoints.token_endpoint?.value;
    if (!endpoint) {
      return result({
        status: 'skip',
        summary: 'No token endpoint was discovered, so there is nothing to probe.'
      });
    }

    // A deliberately invalid grant. A conforming server answers 400
    // invalid_grant WITH CORS headers, which proves four things at once:
    // reachable, CORS-enabled, parses form bodies, and really a token
    // endpoint. Labelled clearly so nobody is puzzled by the 400 in their log.
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'swiss-cors-probe-not-a-real-code',
      redirect_uri: ctx.origin ? `${ctx.origin}/callback` : 'http://localhost:4200/callback',
      client_id: ctx.config.clientId,
      code_verifier: 'swiss-cors-probe-verifier-value-padding-to-min-length'
    }).toString();

    const { exchange, json } = await probe(endpoint, {
      label: 'Token endpoint CORS probe (deliberately invalid grant)',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body,
      fetchImpl: ctx.fetchImpl
    });

    if (exchange.outcome === 'network-or-cors' || exchange.outcome === 'blocked-precondition') {
      return result({
        status: 'fail',
        summary: 'The token endpoint could not be reached from this page.',
        detail: [
          'This is the request that matters most: if it cannot complete, no login can ever finish.',
          '',
          ...(exchange.diagnosis?.evidence.map((e) => `- ${e}`) ?? [])
        ].join('\n'),
        remediations: [
          ...remediations(exchange.diagnosis?.remediationIds ?? []),
          remediation('cors-missing-acao', [curlAction(exchange, ctx.origin), openAction(endpoint)])
        ],
        exchanges: [exchange]
      });
    }

    // We got a readable response, so CORS is fine. Now read the error code,
    // which is free information you cannot otherwise get without a real login.
    const oauthError =
      json && typeof json === 'object' ? (json as Record<string, unknown>).error : undefined;

    if (oauthError === 'invalid_client') {
      return result({
        status: 'fail',
        summary: 'CORS works, but the server rejected the client credentials (`invalid_client`).',
        detail: `The endpoint is reachable and CORS-enabled -- the probe got a readable response.\n\nBut \`invalid_client\` means the server did not accept \`client_id\` \`${ctx.config.clientId}\`${ctx.config.clientSecret ? ' and the secret' : ''}. Had the client been recognised, a deliberately fake authorization code would have produced \`invalid_grant\` instead.\n\nThis distinction is otherwise unobtainable from a browser without completing a full login.`,
        exchanges: [exchange]
      });
    }

    if (oauthError === 'invalid_grant') {
      return result({
        status: 'pass',
        summary: 'The token endpoint is reachable, CORS-enabled, and recognised the client.',
        detail:
          'The probe sent a deliberately fake authorization code and got `invalid_grant`, which is the correct response. Importantly it is *not* `invalid_client`, so the server recognises this `client_id`.',
        exchanges: [exchange]
      });
    }

    if (exchange.response && exchange.response.status < 500) {
      return result({
        status: 'pass',
        summary: `The token endpoint is reachable and CORS-enabled (answered ${exchange.response.status}).`,
        detail: oauthError
          ? `It returned \`${String(oauthError)}\` for the probe rather than the expected \`invalid_grant\`, which is unusual but not a CORS problem.`
          : 'It did not return a standard OAuth error object, which RFC 6749 section 5.2 requires for a failed token request.',
        exchanges: [exchange],
        spec: {
          name: 'RFC 6749',
          section: '5.2',
          url: 'https://datatracker.ietf.org/doc/html/rfc6749#section-5.2'
        }
      });
    }

    return result({
      status: 'warn',
      summary: `The token endpoint answered ${exchange.response?.status ?? 'unexpectedly'}, which suggests a server-side error rather than a configuration problem.`,
      exchanges: [exchange]
    });
  }
};

const tokenEndpointPreflight: Check = {
  id: 'cors.token-endpoint-preflight',
  title: 'Preflight allows an Authorization header',
  group: 'cors',
  dependsOn: ['cors.token-endpoint'],
  async run(ctx) {
    if (ctx.config.clientAuthMethod !== 'basic') {
      return result({
        status: 'skip',
        summary: 'Only relevant for HTTP Basic client authentication, which is not selected.'
      });
    }

    const endpoint = ctx.endpoints.token_endpoint?.value;
    if (!endpoint) {
      return result({ status: 'skip', summary: 'No token endpoint was discovered.' });
    }

    // A form-encoded POST is a CORS-"simple" request and is NOT preflighted.
    // Adding Authorization forces one, which isolates "no
    // Access-Control-Allow-Origin" from "OPTIONS mishandled".
    const credentials = btoa(
      `${encodeURIComponent(ctx.config.clientId)}:${encodeURIComponent(ctx.config.clientSecret)}`
    );
    const { exchange } = await probe(endpoint, {
      label: 'Token endpoint preflight probe (with Authorization)',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'swiss-preflight-probe'
      }).toString(),
      fetchImpl: ctx.fetchImpl
    });

    if (exchange.outcome === 'network-or-cors') {
      return result({
        status: 'fail',
        summary:
          'The same request fails once an Authorization header is added, so the CORS preflight is not configured.',
        detail:
          'The plain probe succeeded but this one did not. The only difference is the `Authorization` header, which forces an `OPTIONS` preflight.',
        remediations: [
          remediation('cors-preflight-authorization', [curlAction(exchange, ctx.origin)])
        ],
        exchanges: [exchange]
      });
    }

    return result({
      status: 'pass',
      summary: 'The preflight allows an Authorization header.',
      exchanges: [exchange]
    });
  }
};

const fhirAuthorizationHeader: Check = {
  id: 'cors.fhir-authorization-header',
  title: 'FHIR server accepts an Authorization header cross-origin',
  group: 'cors',
  async run(ctx) {
    const url = `${ctx.config.fhirBaseUrl.replace(/\/+$/, '')}/metadata`;

    // A dummy bearer token. A 401 WITH CORS headers is a PASS: the auth
    // failure is expected and irrelevant; what we are testing is whether the
    // preflight for Authorization works at all. This predicts the failure the
    // FHIR console would otherwise hit later.
    const { exchange } = await probe(url, {
      label: 'FHIR preflight probe (dummy bearer token)',
      headers: {
        Authorization: 'Bearer swiss-cors-probe-not-a-real-token',
        Accept: 'application/fhir+json'
      },
      fetchImpl: ctx.fetchImpl
    });

    if (exchange.outcome === 'network-or-cors' || exchange.outcome === 'blocked-precondition') {
      return result({
        status: 'fail',
        summary:
          'The FHIR server rejects cross-origin requests that carry an Authorization header.',
        detail: [
          'Every authenticated FHIR request is preflighted, so this would break the FHIR console for all queries, not just this probe.',
          '',
          ...(exchange.diagnosis?.evidence.map((e) => `- ${e}`) ?? [])
        ].join('\n'),
        remediations: [
          remediation('cors-preflight-authorization', [
            curlAction(exchange, ctx.origin),
            openAction(url)
          ])
        ],
        exchanges: [exchange]
      });
    }

    const status = exchange.response?.status ?? 0;
    if (status === 401 || status === 403) {
      return result({
        status: 'pass',
        summary: `The FHIR server answered ${status} with readable CORS headers, which is exactly right for a fake token.`,
        detail:
          'The authentication failure is expected and irrelevant here. What this proves is that the preflight for an `Authorization` header succeeds, so real authenticated queries will work.',
        exchanges: [exchange]
      });
    }

    if (status === 200) {
      return result({
        status: 'warn',
        summary:
          'The FHIR server returned 200 for a request carrying an obviously invalid bearer token.',
        detail:
          '`/metadata` is commonly public, so this may be fine. But if other endpoints behave the same way, the server is not validating bearer tokens.',
        exchanges: [exchange]
      });
    }

    return result({
      status: 'warn',
      summary: `The FHIR server answered ${status} for the probe.`,
      exchanges: [exchange]
    });
  }
};

const exposedHeaders: Check = {
  id: 'cors.expose-headers',
  title: 'Response headers are readable',
  group: 'cors',
  dependsOn: ['cors.fhir-authorization-header'],
  async run(ctx) {
    const url = `${ctx.config.fhirBaseUrl.replace(/\/+$/, '')}/metadata`;
    const { exchange } = await probe(url, {
      label: 'Header exposure probe',
      headers: { Accept: 'application/fhir+json' },
      fetchImpl: ctx.fetchImpl
    });

    if (!exchange.response) {
      return result({ status: 'skip', summary: 'No readable response to inspect.' });
    }

    const readable = Object.keys(exchange.response.headers);
    return result({
      status: 'pass',
      summary: `${readable.length} response header(s) are readable from this page.`,
      detail: `Readable: ${readable.join(', ')}\n\nNote that a cross-origin response only exposes a short safelist plus whatever the server names in \`Access-Control-Expose-Headers\`. \`WWW-Authenticate\` and \`Location\` are invisible to Swiss unless explicitly exposed -- so where they matter, Swiss reports that it could not read them rather than showing them as absent.`,
      exchanges: [exchange]
    });
  }
};

export const corsChecks: Check[] = [
  tokenEndpointCors,
  tokenEndpointPreflight,
  fhirAuthorizationHeader,
  exposedHeaders
];
