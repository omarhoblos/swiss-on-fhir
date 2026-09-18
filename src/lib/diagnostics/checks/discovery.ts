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

import type { HttpExchange } from '$lib/http/exchange';
import { probeJson } from '$lib/http/probe';
import { httpUrl } from '$lib/url';
import {
  fetchCapabilityOauthUris,
  fetchOpenidConfiguration,
  fetchSmartConfiguration,
  fetchSmartConfigurationAtRoot,
  normaliseFhirBase,
  readCapabilities,
  urlEquivalence
} from '$lib/smart/discovery';
import { remediation, remediations } from '../remediation';
import { result, type Check } from '../types';

/** SMART 2.0 requires these in smart-configuration. */
const REQUIRED_SMART_FIELDS = [
  'authorization_endpoint',
  'token_endpoint',
  'capabilities',
  'code_challenge_methods_supported'
] as const;

/** SHOULD-level fields: absence is a warning, not a failure. */
const RECOMMENDED_SMART_FIELDS = [
  'grant_types_supported',
  'scopes_supported',
  'revocation_endpoint',
  'introspection_endpoint',
  'management_endpoint'
] as const;

const fhirBaseReachable: Check = {
  id: 'disc.fhir-base-reachable',
  title: 'FHIR server is reachable',
  group: 'discovery',
  async run(ctx) {
    const url = `${normaliseFhirBase(ctx.config.fhirBaseUrl)}/metadata?_summary=true`;
    const { exchange, json } = await probeJson(url, {
      label: 'FHIR CapabilityStatement',
      headers: { Accept: 'application/fhir+json' },
      fetchImpl: ctx.fetchImpl
    });

    if (exchange.outcome === 'network-or-cors' || exchange.outcome === 'blocked-precondition') {
      return result({
        status: 'fail',
        summary: 'Could not reach the FHIR server.',
        detail: exchange.diagnosis?.evidence.map((e) => `- ${e}`).join('\n'),
        remediations: remediations(exchange.diagnosis?.remediationIds ?? []),
        exchanges: [exchange]
      });
    }

    const resourceType =
      json && typeof json === 'object' ? (json as Record<string, unknown>).resourceType : undefined;

    if (resourceType === 'CapabilityStatement') {
      return result({
        status: 'pass',
        summary: `The FHIR server responded with a CapabilityStatement in ${exchange.durationMs}ms.`,
        exchanges: [exchange]
      });
    }

    if (exchange.response && exchange.response.status >= 400) {
      return result({
        status: 'warn',
        summary: `The FHIR server answered ${exchange.response.status} for /metadata. It is reachable, but not serving a CapabilityStatement.`,
        detail:
          'Some servers require authentication even for /metadata, which is non-conformant but common.',
        exchanges: [exchange]
      });
    }

    return result({
      status: 'warn',
      summary: 'Something answered, but it does not look like a FHIR server.',
      detail: `Expected a \`CapabilityStatement\`, got \`${String(resourceType ?? 'no resourceType')}\`. Check that the FHIR base URL is the base, not a page in front of it.`,
      exchanges: [exchange]
    });
  }
};

const smartConfiguration: Check = {
  id: 'disc.smart-configuration',
  title: 'SMART configuration document',
  group: 'discovery',
  async run(ctx) {
    const primary = await fetchSmartConfiguration(ctx.config.fhirBaseUrl, ctx.fetchImpl);
    const exchanges = [primary.exchange];
    let doc = primary.document;
    let answeredAt = primary.url;

    // Not conformant, but common enough to be worth the second look.
    if (!doc) {
      const atRoot = await fetchSmartConfigurationAtRoot(ctx.config.fhirBaseUrl, ctx.fetchImpl);
      if (atRoot) {
        exchanges.push(atRoot.exchange);
        if (atRoot.document) {
          doc = atRoot.document;
          answeredAt = atRoot.url;
        }
      }
    }

    if (!doc) {
      return result({
        status: 'fail',
        summary: 'No SMART configuration document was served.',
        detail: `Tried:\n\n${exchanges.map((e) => `- \`${e.request.url}\` — ${e.response ? `${e.response.status} ${e.response.statusText}` : e.outcome}`).join('\n')}`,
        remediations: [
          remediation('smart-config-missing'),
          ...remediations(primary.exchange.diagnosis?.remediationIds ?? [])
        ],
        exchanges,
        spec: {
          name: 'SMART App Launch',
          section: 'Conformance',
          url: 'https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html'
        }
      });
    }

    const missingRequired = REQUIRED_SMART_FIELDS.filter((f) => doc?.[f] === undefined);
    const missingRecommended = RECOMMENDED_SMART_FIELDS.filter((f) => doc?.[f] === undefined);
    const caps = readCapabilities(doc);

    const notes: string[] = [];
    if (answeredAt !== primary.url) {
      notes.push(
        `Served from \`${answeredAt}\` rather than the FHIR base. SMART expects it at \`${primary.url}\`, so a stricter client may not find it.`
      );
    }
    if (caps === null) {
      notes.push(
        'No `capabilities` (or SMART 1.0 `smart_capabilities`) list, so Swiss cannot tell which launch modes and scope syntax the server supports. Controls stay enabled and marked "not advertised".'
      );
    }
    if (primary.exchange.outcome === 'bad-content-type') {
      notes.push(
        'The document parsed as JSON but was served with a non-JSON `Content-Type`. Swiss accepts it; a stricter client may not.'
      );
    }
    if (missingRecommended.length > 0) {
      notes.push(`Missing SHOULD-level fields: ${missingRecommended.join(', ')}.`);
    }

    if (missingRequired.length > 0) {
      return result({
        status: 'fail',
        summary: `The SMART configuration is missing ${missingRequired.length} required field(s): ${missingRequired.join(', ')}.`,
        detail: notes.map((n) => `- ${n}`).join('\n'),
        exchanges,
        spec: {
          name: 'SMART App Launch',
          section: 'Conformance',
          url: 'https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html'
        }
      });
    }

    return result({
      status: notes.length > 0 ? 'warn' : 'pass',
      summary:
        notes.length > 0
          ? 'The SMART configuration has all required fields, with caveats.'
          : `The SMART configuration is complete, with ${caps?.length ?? 0} capabilities advertised.`,
      detail: notes.map((n) => `- ${n}`).join('\n'),
      exchanges
    });
  }
};

const openidConfiguration: Check = {
  id: 'disc.openid-configuration',
  title: 'OpenID configuration and issuer match',
  group: 'discovery',
  async run(ctx) {
    const { document, exchange, url } = await fetchOpenidConfiguration(
      ctx.config.authIssuer,
      ctx.fetchImpl
    );

    if (!document) {
      return result({
        status: 'fail',
        summary: 'No OpenID configuration document was served by the authorization server.',
        detail: exchange.diagnosis?.evidence.map((e) => `- ${e}`).join('\n'),
        remediations: remediations(exchange.diagnosis?.remediationIds ?? []),
        exchanges: [exchange]
      });
    }

    const declared = typeof document.issuer === 'string' ? document.issuer : null;
    if (!declared) {
      return result({
        status: 'warn',
        summary:
          'The document loaded but declares no `issuer`, which OpenID Connect Discovery requires.',
        exchanges: [exchange]
      });
    }

    // OIDC Discovery 4.3: the issuer must be byte-identical to the URL the
    // document was fetched from. This is the check that explains why
    // skipIssuerCheck exists in this project at all.
    const equivalence = urlEquivalence(declared, ctx.config.authIssuer);

    if (equivalence === 'identical') {
      return result({
        status: 'pass',
        summary: 'The declared issuer matches the configured authorization server exactly.',
        exchanges: [exchange]
      });
    }

    const adoptAction = {
      kind: 'set-config' as const,
      label: `Use "${declared}" as the authorization server`,
      patch: { authIssuer: declared }
    };
    const skipAction = {
      kind: 'set-config' as const,
      label: 'Disable the issuer check (non-compliant)',
      patch: { skipIssuerCheck: true }
    };

    const detail = `Fetched from: \`${url}\`\nDeclared \`issuer\`: \`${declared}\`\nConfigured: \`${ctx.config.authIssuer}\`\n\nThe difference is ${
      equivalence === 'trivially-different'
        ? 'cosmetic (host case, a default port, or a trailing slash) -- but OIDC Discovery requires a byte-identical match, so a conforming client still rejects it.'
        : 'substantive: these are different URLs.'
    }`;

    if (ctx.config.skipIssuerCheck) {
      return result({
        status: 'warn',
        summary:
          'The issuer does not match, but the issuer check is disabled so Swiss will proceed.',
        detail,
        remediations: [remediation('issuer-mismatch', [adoptAction])],
        exchanges: [exchange],
        spec: {
          name: 'OpenID Connect Discovery',
          section: '4.3',
          url: 'https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationValidation'
        }
      });
    }

    return result({
      status: 'fail',
      summary: 'The declared issuer does not match the configured authorization server.',
      detail,
      remediations: [remediation('issuer-mismatch', [adoptAction, skipAction])],
      exchanges: [exchange],
      spec: {
        name: 'OpenID Connect Discovery',
        section: '4.3',
        url: 'https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationValidation'
      }
    });
  }
};

const capabilityStatementOauthUris: Check = {
  id: 'disc.capability-oauth-uris',
  title: 'SMART 1.0 OAuth URIs extension',
  group: 'discovery',
  dependsOn: ['disc.fhir-base-reachable'],
  async run(ctx) {
    const { document, exchange } = await fetchCapabilityOauthUris(
      ctx.config.fhirBaseUrl,
      ctx.fetchImpl
    );

    if (!document) {
      return result({
        status: 'pass',
        summary:
          'No SMART 1.0 OAuth URIs extension, which is fine if the SMART configuration document is present.',
        detail:
          'This extension is the SMART 1.0 way of advertising OAuth endpoints, and is only needed as a fallback for servers without `/.well-known/smart-configuration`.',
        exchanges: [exchange]
      });
    }

    return result({
      status: 'pass',
      summary: `The CapabilityStatement advertises ${Object.keys(document).length} OAuth endpoint(s) via the SMART 1.0 extension.`,
      detail: Object.entries(document)
        .map(([k, v]) => `- \`${k}\`: ${String(v)}`)
        .join('\n'),
      exchanges: [exchange]
    });
  }
};

const endpointAgreement: Check = {
  id: 'disc.endpoint-agreement',
  title: 'Discovery documents agree',
  group: 'discovery',
  async run(ctx) {
    const conflicts = ctx.docs ? [] : [];
    void conflicts;

    // The merge has already happened by the time checks run; this reports it.
    const endpoints = Object.entries(ctx.endpoints);
    if (endpoints.length === 0) {
      return result({
        status: 'skip',
        summary: 'No endpoints were resolved, so there is nothing to compare.'
      });
    }

    const bySource = endpoints.reduce<Record<string, number>>((acc, [, sourced]) => {
      acc[sourced.source] = (acc[sourced.source] ?? 0) + 1;
      return acc;
    }, {});

    return result({
      status: 'pass',
      summary: `${endpoints.length} endpoint(s) resolved: ${Object.entries(bySource)
        .map(([source, count]) => `${count} from ${source}`)
        .join(', ')}.`,
      detail: endpoints
        .map(([key, sourced]) => `- \`${key}\`: ${sourced.value} _(${sourced.source})_`)
        .join('\n')
    });
  }
};

/** The conventional JWKS location. Anything else still works, but is flagged. */
const CONVENTIONAL_JWKS_PATH = '/.well-known/jwks.json';

/** A document's `jwks_uri`, if it is an http(s) URL. */
function advertisedJwksUri(doc: Record<string, unknown> | undefined): string | null {
  const value = doc?.jwks_uri;
  return httpUrl(typeof value === 'string' ? value : undefined);
}

const jwks: Check = {
  id: 'disc.jwks',
  title: 'JWKS is fetchable',
  group: 'discovery',
  async run(ctx) {
    // smart-configuration first, because in SMART the FHIR server is
    // authoritative; openid-configuration only as the fallback.
    const smartUri = advertisedJwksUri(ctx.docs['smart-configuration']);
    const openidUri = advertisedJwksUri(ctx.docs['openid-configuration']);

    if (!smartUri && !openidUri) {
      return result({
        status: 'fail',
        summary: 'Neither smart-configuration nor openid-configuration advertises a `jwks_uri`.',
        detail:
          'SMART requires `jwks_uri` when the server claims the `sso-openid-connect` capability, and OpenID Connect Discovery requires it outright. Without it, ID token signatures cannot be verified.',
        spec: {
          name: 'OpenID Connect Discovery',
          section: '3',
          url: 'https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata'
        }
      });
    }

    const exchanges: HttpExchange[] = [];
    const fetchKeys = async (url: string): Promise<unknown[] | null> => {
      const { json, exchange } = await probeJson(url, {
        label: 'JWKS',
        headers: { Accept: 'application/json' },
        fetchImpl: ctx.fetchImpl
      });
      exchanges.push(exchange);
      const keys =
        json && typeof json === 'object' ? (json as Record<string, unknown>).keys : undefined;
      return Array.isArray(keys) ? keys : null;
    };

    let answered: { url: string; keys: unknown[] } | null = null;
    if (smartUri) {
      const keys = await fetchKeys(smartUri);
      if (keys) answered = { url: smartUri, keys };
    }
    // The same URL in both documents has already failed; probing it again
    // would only add a duplicate to the log.
    if (!answered && openidUri && openidUri !== smartUri) {
      const keys = await fetchKeys(openidUri);
      if (keys) answered = { url: openidUri, keys };
    }

    if (!answered) {
      const tried = exchanges
        .map(
          (e) =>
            `- \`${e.request.url}\` — ${e.response ? `${e.response.status} ${e.response.statusText}` : e.outcome}`
        )
        .join('\n');
      return result({
        status: 'fail',
        summary:
          smartUri && openidUri
            ? 'The `jwks_uri` in both smart-configuration and openid-configuration is unreachable.'
            : `The \`jwks_uri\` in ${smartUri ? 'smart-configuration' : 'openid-configuration'} is unreachable, and ${smartUri ? 'openid-configuration' : 'smart-configuration'} advertises none.`,
        detail: `Tried:\n${tried}`,
        remediations: remediations(exchanges.flatMap((e) => e.diagnosis?.remediationIds ?? [])),
        exchanges
      });
    }

    const { url, keys } = answered;
    const described = keys
      .map((k) => {
        const key = k as Record<string, unknown>;
        return `\`${String(key.kty ?? '?')}\`/${String(key.alg ?? 'no alg')}${key.kid ? ` (kid: ${String(key.kid)})` : ' (no kid)'}`;
      })
      .join(', ');

    const fromOpenid = url !== smartUri;
    const missingKid = keys.some((k) => !(k as Record<string, unknown>).kid);
    const unconventional = !new URL(url).pathname.endsWith(CONVENTIONAL_JWKS_PATH);

    const notes: string[] = [described];
    if (fromOpenid) {
      notes.push(
        smartUri
          ? `The \`jwks_uri\` in smart-configuration (\`${smartUri}\`) is unreachable. The one in openid-configuration (\`${url}\`) works, so fix smart-configuration to match.`
          : `smart-configuration advertises no \`jwks_uri\`. The one in openid-configuration (\`${url}\`) works; publish it in smart-configuration too.`
      );
    }
    if (unconventional) {
      notes.push(
        `The \`jwks_uri\` (\`${url}\`) is not at \`${CONVENTIONAL_JWKS_PATH}\`. It works, but clients that assume the conventional location will not find the keys.`
      );
    }
    if (missingKid) {
      notes.push(
        'At least one key has no `kid`. With more than one key, verification has to try each in turn.'
      );
    }

    const caveats = [
      fromOpenid &&
        (smartUri
          ? "smart-configuration's is unreachable"
          : 'only openid-configuration advertises it'),
      unconventional && `not at \`${CONVENTIONAL_JWKS_PATH}\``
    ].filter(Boolean);

    return result({
      status: fromOpenid || unconventional || missingKid ? 'warn' : 'pass',
      summary:
        caveats.length > 0
          ? `${keys.length} signing key(s) published, but ${caveats.join(' and ')}.`
          : `${keys.length} signing key(s) published.`,
      detail: notes.join('\n\n'),
      exchanges
    });
  }
};

export const discoveryChecks: Check[] = [
  fhirBaseReachable,
  smartConfiguration,
  openidConfiguration,
  capabilityStatementOauthUris,
  endpointAgreement,
  jwks
];
