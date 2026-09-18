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
  scopes: 'openid fhirUser offline_access launch/patient patient/*.read'
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

/** A session as the callback would have stored it, so no login is needed. */
export async function seedSession(page: Page, overrides: Record<string, unknown> = {}) {
  const obtainedAt = Date.now();
  const session = {
    tokens: {
      access_token: 'access-1',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-1',
      scope: RUNTIME_CONFIG.scopes
    },
    context: {
      patient: { source: 'none' },
      encounter: { source: 'none' },
      fhirUser: { source: 'none' },
      extras: {}
    },
    obtainedAt,
    expiresAt: obtainedAt + 3600 * 1000,
    requestedScopes: RUNTIME_CONFIG.scopes,
    intent: { flavor: 'standalone' },
    configSnapshot: {
      fhirBaseUrl: FHIR_BASE,
      authIssuer: AUTH_ISSUER,
      clientId: RUNTIME_CONFIG.clientId,
      hasClientSecret: false,
      scopes: RUNTIME_CONFIG.scopes,
      clientAuthMethod: 'none',
      audMode: 'exact',
      scopeSyntax: 'auto',
      tokenStorage: 'session',
      redactSecrets: true
    },
    tokenEndpoint: `${AUTH_ISSUER}/token`,
    revocationEndpoint: `${AUTH_ISSUER}/revoke`,
    ...overrides
  };
  await page.addInitScript((value) => {
    sessionStorage.setItem('swiss.session.v1', value);
  }, JSON.stringify(session));
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
