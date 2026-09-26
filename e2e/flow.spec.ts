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

import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import {
  AUTH_ISSUER,
  expect,
  FHIR_BASE,
  RUNTIME_CONFIG,
  SMART_CONFIGURATION,
  stubDiscovery,
  test
} from './fixtures';

/**
 * The whole authorization code flow, end to end, against a stubbed identity
 * provider that behaves like a real one: it redirects back with the state it
 * was given, checks the PKCE verifier at the token endpoint, and signs an ID
 * token with a key it publishes at its JWKS URI.
 *
 * Every other spec seeds a session straight into storage. This is the one
 * that proves the redirect, the callback and the exchange fit together.
 */

interface Idp {
  /** Parameters captured from the authorize request. */
  authorize: URLSearchParams | null;
  /** Form fields captured from each token request, in order. */
  tokenRequests: URLSearchParams[];
}

interface IdpOptions {
  /** Advertise RFC 9207 support in the OpenID configuration. Default true. */
  advertiseIss?: boolean;
  /** The `iss` to put on the redirect; `null` omits it. Default the issuer. */
  redirectIss?: string | null;
  /** The nonce to put in the ID token; default echoes the request's nonce. */
  nonce?: (requested: string | null) => string | undefined;
  /** Which key signs the ID token returned by a refresh. Default the same one. */
  refreshSigner?: 'same' | 'other';
}

let signer: CryptoKey;
let otherSigner: CryptoKey;
let jwks: string;

test.beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signer = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwks = JSON.stringify({ keys: [{ ...jwk, kid: 'e2e', alg: 'RS256', use: 'sig' }] });
  otherSigner = (await generateKeyPair('RS256', { extractable: true })).privateKey;
});

async function idToken(claims: Record<string, unknown>, key: CryptoKey = signer) {
  return new SignJWT({ iss: AUTH_ISSUER, aud: RUNTIME_CONFIG.clientId, sub: 'user-1', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'e2e' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

async function installIdp(page: Page, options: IdpOptions = {}): Promise<Idp> {
  const idp: Idp = { authorize: null, tokenRequests: [] };
  const advertiseIss = options.advertiseIss ?? true;

  await stubDiscovery(page);

  // Later routes win, so these override the generic stubs.
  await page.route(`${AUTH_ISSUER}/.well-known/openid-configuration`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...SMART_CONFIGURATION,
        ...(advertiseIss ? { authorization_response_iss_parameter_supported: true } : {})
      })
    })
  );
  await page.route(`${AUTH_ISSUER}/.well-known/jwks.json`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: jwks })
  );

  // The authorization endpoint: a real one would show a login page; this one
  // consents immediately and redirects back with a code.
  await page.route(`${AUTH_ISSUER}/authorize**`, (route: Route) => {
    const params = new URL(route.request().url()).searchParams;
    idp.authorize = params;
    const redirect = new URL(params.get('redirect_uri')!);
    redirect.searchParams.set('code', 'code-1');
    redirect.searchParams.set('state', params.get('state')!);
    const iss = options.redirectIss === undefined ? AUTH_ISSUER : options.redirectIss;
    if (iss !== null) redirect.searchParams.set('iss', iss);
    return route.fulfill({ status: 302, headers: { location: redirect.toString() } });
  });

  await page.route(`${AUTH_ISSUER}/token`, async (route: Route) => {
    const form = new URLSearchParams(route.request().postData() ?? '');
    idp.tokenRequests.push(form);
    const grant = form.get('grant_type');

    if (grant === 'authorization_code') {
      // What a conforming server checks before issuing anything.
      const verifier = form.get('code_verifier') ?? '';
      const expected = idp.authorize?.get('code_challenge');
      const ok =
        form.get('code') === 'code-1' &&
        form.get('redirect_uri') === idp.authorize?.get('redirect_uri') &&
        form.get('client_id') === RUNTIME_CONFIG.clientId &&
        createHash('sha256').update(verifier).digest('base64url') === expected;
      if (!ok) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'invalid_grant',
            error_description: 'PKCE or code mismatch'
          })
        });
      }
      const requestedNonce = idp.authorize?.get('nonce') ?? null;
      const nonce = options.nonce ? options.nonce(requestedNonce) : (requestedNonce ?? undefined);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'access-1',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'refresh-1',
          scope: RUNTIME_CONFIG.scopes,
          patient: 'p-123',
          id_token: await idToken(nonce ? { nonce } : {})
        })
      });
    }

    if (grant === 'refresh_token') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'access-2',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: RUNTIME_CONFIG.scopes,
          id_token: await idToken({}, options.refreshSigner === 'other' ? otherSigner : signer)
        })
      });
    }

    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unsupported_grant_type' })
    });
  });

  return idp;
}

/** The token panels are collapsed <details>; open one to read its note. */
async function openPanel(page: Page, title: 'Access token' | 'ID token') {
  const panel = page.locator('details').filter({ hasText: title }).first();
  if (!(await panel.getAttribute('open'))) await panel.locator('summary').click();
  return panel;
}

async function startLaunch(page: Page) {
  await page.goto('/launch');
  await page.getByRole('button', { name: 'Start launch' }).click();
  await page.waitForURL('http://localhost:4173/');
  await expect(page.getByRole('heading', { name: 'Session', exact: true })).toBeVisible();
}

test.describe('authorization code flow', () => {
  test('signs in: PKCE S256, aud, state round-trip, verified ID token, launch context', async ({
    page
  }) => {
    const idp = await installIdp(page);
    await startLaunch(page);

    // The authorize request Swiss actually sent.
    const q = idp.authorize!;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe(RUNTIME_CONFIG.clientId);
    expect(q.get('redirect_uri')).toBe('http://localhost:4173/callback');
    expect(q.get('aud')).toBe(FHIR_BASE);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('state')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(q.get('nonce')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(q.get('scope')).toBe(RUNTIME_CONFIG.scopes);
    expect(q.has('client_secret')).toBe(false);

    // The stub only issues tokens when the verifier matched the challenge,
    // so reaching the inspector with a session proves PKCE end to end.
    expect(idp.tokenRequests).toHaveLength(1);
    const panel = await openPanel(page, 'ID token');
    await expect(panel.getByText(/checked at sign-in and held up/)).toBeVisible();
    await expect(page.getByText('p-123').first()).toBeVisible();

    // The code was stripped from the URL before the exchange.
    expect(page.url()).not.toContain('code=');
  });

  test('shows a wrong nonce as a finding and still shows the tokens', async ({ page }) => {
    await installIdp(page, { nonce: () => 'someone-elses' });
    await startLaunch(page);

    const panel = await openPanel(page, 'ID token');
    await expect(panel.getByText(/Checked at sign-in and NOT verified/)).toBeVisible();
    await expect(panel.getByText(/`nonce` in the ID token does not match/)).toBeVisible();
    // Never a refusal: the access token is there too.
    const access = await openPanel(page, 'Access token');
    await expect(access.getByText('access-1').first()).toBeVisible();
  });

  test('reports an iss on the redirect that names a different server', async ({ page }) => {
    await installIdp(page, { redirectIss: 'https://evil.test' });
    await page.goto('/launch');
    await page.getByRole('button', { name: 'Start launch' }).click();

    // The warning lives on the callback page, which lingers briefly.
    await page.waitForURL(/\/callback/);
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await expect(page.getByText(/iss=https:\/\/evil\.test.*does not match/)).toBeVisible();
  });

  test('reports a missing iss when the server advertised RFC 9207', async ({ page }) => {
    await installIdp(page, { redirectIss: null });
    await page.goto('/launch');
    await page.getByRole('button', { name: 'Start launch' }).click();

    await page.waitForURL(/\/callback/);
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await expect(page.getByText(/sent no `iss` with the code/)).toBeVisible();
  });

  test('is silent about iss when the server never promised one', async ({ page }) => {
    await installIdp(page, { advertiseIss: false, redirectIss: null });
    await page.goto('/launch');
    await page.getByRole('button', { name: 'Start launch' }).click();

    await page.waitForURL(/\/callback/);
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await expect(page.getByText(/`iss`/)).toHaveCount(0);
  });

  test('re-checks an ID token returned by a refresh', async ({ page }) => {
    const idp = await installIdp(page, { refreshSigner: 'other' });
    await startLaunch(page);
    const panel = await openPanel(page, 'ID token');
    await expect(panel.getByText(/checked at sign-in and held up/)).toBeVisible();

    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(page.getByText(/^Refreshed\..*did NOT verify/)).toBeVisible();
    expect(idp.tokenRequests.at(-1)?.get('grant_type')).toBe('refresh_token');

    // The new token is signed by a key the JWKS does not hold, and the panel
    // says so instead of repeating the sign-in verdict.
    await expect(panel.getByText(/Checked at the last refresh and NOT verified/)).toBeVisible();
  });

  test('keeps a verified refresh verdict when the same key signs it', async ({ page }) => {
    await installIdp(page);
    await startLaunch(page);
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(page.getByText(/^Refreshed\..*The new ID token verified\./)).toBeVisible();
    const panel = await openPanel(page, 'ID token');
    await expect(panel.getByText(/checked at the last refresh and held up/)).toBeVisible();
  });
});
