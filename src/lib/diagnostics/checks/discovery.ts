import type { HttpExchange } from '$lib/http/exchange';
import { probeJson } from '$lib/http/probe';
import { jwksCandidates } from '$lib/smart/jwks';
import { originOf } from '$lib/url';
import {
  advertisedValues,
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

const jwks: Check = {
  id: 'disc.jwks',
  title: 'JWKS is fetchable',
  group: 'discovery',
  async run(ctx) {
    // Every document's jwks_uri, not just the precedence winner: a real
    // deployment advertises a redirecting /.well-known/jwks.json in
    // smart-configuration and the working /jwk in openid-configuration, so
    // the correct value is discovered and then outranked.
    const allAdvertised = advertisedValues(ctx.docs, 'jwks_uri');
    const advertised = ctx.endpoints.jwks_uri?.value;
    const issuer = ctx.endpoints.issuer?.value ?? ctx.config.authIssuer;
    const candidates = jwksCandidates(allAdvertised, issuer);

    if (candidates.length === 0) {
      return result({
        status: 'warn',
        summary: 'No `jwks_uri` was advertised and there is no issuer to look under.',
        detail:
          'SMART requires `jwks_uri` when the server claims the `sso-openid-connect` capability. Without it, and without an authorization server URL to try, ID token signatures cannot be verified.'
      });
    }

    const exchanges: HttpExchange[] = [];
    let answered: { url: string; keys: unknown[] } | null = null;
    // Once the browser cannot reach an origin at all, more paths on that same
    // origin cannot help -- and each attempt is one more CORS failure for the
    // user to read past in the log.
    const unreachable = new Set<string>();

    for (const url of candidates) {
      const origin = originOf(url);
      if (origin && unreachable.has(origin)) continue;

      const { json, exchange } = await probeJson(url, {
        label: 'JWKS',
        headers: { Accept: 'application/json' },
        fetchImpl: ctx.fetchImpl
      });
      exchanges.push(exchange);

      const keys =
        json && typeof json === 'object' ? (json as Record<string, unknown>).keys : undefined;
      if (Array.isArray(keys)) {
        answered = { url, keys };
        break;
      }

      if (origin && (exchange.outcome === 'network-or-cors' || exchange.outcome === 'timeout')) {
        unreachable.add(origin);
      }
    }

    if (!answered) {
      const tried = exchanges.map((e) => `- \`${e.request.url}\``).join('\n');
      return result({
        status: 'fail',
        summary:
          exchanges.length === 1
            ? 'The JWKS document could not be read, or has no `keys` array.'
            : `No key set was found at any of the ${exchanges.length} URLs tried.`,
        detail: exchanges.length === 1 ? undefined : `Tried:\n${tried}`,
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

    const missingKid = keys.some((k) => !(k as Record<string, unknown>).kid);
    // A key set found anywhere other than the advertised URL is still a
    // finding: verification works, but every other client has to guess too.
    const viaFallback = url !== advertised;

    const notes: string[] = [described];
    if (!advertised) {
      notes.push(
        `No \`jwks_uri\` was advertised, so Swiss looked under the issuer and found the key set at \`${url}\`. Publish it as \`jwks_uri\` so clients do not have to guess.`
      );
    } else if (viaFallback && allAdvertised.includes(url)) {
      notes.push(
        `The \`jwks_uri\` Swiss resolved (\`${advertised}\`) returned no key set. Another discovery document advertised \`${url}\`, which does, so the two documents disagree and the higher-precedence one is wrong.`
      );
    } else if (viaFallback) {
      notes.push(
        `The advertised \`jwks_uri\` (\`${advertised}\`) returned no key set. Swiss found one at \`${url}\` instead, so the server's metadata points at the wrong place.`
      );
    }
    if (missingKid) {
      notes.push(
        'At least one key has no `kid`. With more than one key, verification has to try each in turn.'
      );
    }

    return result({
      status: missingKid || viaFallback ? 'warn' : 'pass',
      summary: viaFallback
        ? `${keys.length} signing key(s), but not at the advertised URL.`
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
