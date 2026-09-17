import { test as base, type Page } from '@playwright/test';

/**
 * Serves a known runtime configuration and stubbed discovery documents.
 *
 * The production build ships a defaults-only swiss-env.json (so a build never
 * bakes in anyone's .env), which is exactly what we want to override here.
 */
export const FHIR_BASE = 'https://fhir.test';
export const AUTH_ISSUER = 'https://idp.test';

export const RUNTIME_CONFIG = {
  fhirBaseUrl: FHIR_BASE,
  authIssuer: AUTH_ISSUER,
  clientId: 'e2e-client',
  clientSecret: '',
  scopes: 'openid fhirUser offline_access launch/patient patient/*.read',
  skipIssuerCheck: 'false'
};

export const SMART_CONFIGURATION = {
  issuer: AUTH_ISSUER,
  jwks_uri: `${AUTH_ISSUER}/.well-known/jwks.json`,
  authorization_endpoint: `${AUTH_ISSUER}/authorize`,
  token_endpoint: `${AUTH_ISSUER}/token`,
  revocation_endpoint: `${AUTH_ISSUER}/revoke`,
  introspection_endpoint: `${AUTH_ISSUER}/introspect`,
  management_endpoint: `${AUTH_ISSUER}/manage`,
  grant_types_supported: ['authorization_code', 'refresh_token'],
  scopes_supported: ['openid', 'fhirUser', 'offline_access', 'launch/patient', 'patient/*.read'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  capabilities: [
    'launch-standalone',
    'client-public',
    'sso-openid-connect',
    'context-standalone-patient',
    'permission-patient',
    'permission-v1'
  ]
};

export async function stubRuntimeConfig(page: Page, config: Record<string, string> | string) {
  await page.route('**/swiss-env.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: typeof config === 'string' ? config : JSON.stringify(config)
    })
  );
}

export async function stubDiscovery(page: Page) {
  await page.route(`${FHIR_BASE}/.well-known/smart-configuration`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SMART_CONFIGURATION)
    })
  );
  await page.route(`${AUTH_ISSUER}/.well-known/openid-configuration`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...SMART_CONFIGURATION, issuer: AUTH_ISSUER })
    })
  );
  await page.route(`${AUTH_ISSUER}/.well-known/jwks.json`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        keys: [{ kty: 'RSA', alg: 'RS256', use: 'sig', kid: 'k1', n: 'abc', e: 'AQAB' }]
      })
    })
  );
  await page.route(`${FHIR_BASE}/metadata**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/fhir+json',
      body: JSON.stringify({
        resourceType: 'CapabilityStatement',
        status: 'active',
        fhirVersion: '4.0.1'
      })
    })
  );
  // A conforming token endpoint answers a bad grant with 400 invalid_grant.
  await page.route(`${AUTH_ISSUER}/token`, (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'Unknown code' })
    })
  );
}

export const test = base.extend<{ configured: void }>({
  configured: [
    async ({ page }, use) => {
      await stubRuntimeConfig(page, RUNTIME_CONFIG);
      await use();
    },
    { auto: true }
  ]
});

export { expect } from '@playwright/test';
