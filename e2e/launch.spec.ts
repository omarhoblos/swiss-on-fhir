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

import {
  expect,
  test,
  AUTH_ISSUER,
  FHIR_BASE,
  SMART_CONFIGURATION,
  seedSession,
  stubDiscovery
} from './fixtures';

test.describe('EHR launch parameters', () => {
  test('ignores an iss that is not an http(s) URL', async ({ page }) => {
    // iss becomes the FHIR base, the aud, and the host every discovery
    // document is fetched from. A link can supply it, so it is validated.
    await stubDiscovery(page);
    await page.goto('/launch?iss=javascript:alert(1)&launch=abc');

    // Alert titles are paragraphs, not headings.
    await expect(page.getByText('The iss parameter is not an http(s) URL')).toBeVisible();
    // The configured FHIR base is untouched.
    await expect(page.getByText('FHIR base overridden for this session')).toHaveCount(0);
    await page.goto('/config');
    await expect(page.locator('#config-fhirBaseUrl')).toHaveValue(FHIR_BASE);
  });

  test('warns when a launch would send the client secret to the iss server', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/config');
    const secret = page.locator('#config-clientSecret');
    await secret.fill('hunter2');
    // Fields commit on change, which Chromium only fires on blur.
    await secret.blur();
    await page.locator('#config-clientAuthMethod').selectOption('basic');
    // The config page's own warning proves both edits landed before leaving.
    await expect(page.getByText(/A client secret is set/)).toBeVisible();

    await page.goto('/launch?iss=https://other-ehr.test/fhir&launch=abc');
    await expect(page.getByText('Your client secret will be sent to this server')).toBeVisible();
    await expect(page.getByText('https://other-ehr.test/fhir').first()).toBeVisible();
  });

  test('does not warn about the secret for a public client', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/launch?iss=https://other-ehr.test/fhir&launch=abc');
    await expect(page.getByText('EHR launch detected')).toBeVisible();
    await expect(page.getByText('Your client secret will be sent to this server')).toHaveCount(0);
  });
});

test.describe('a launch link and what it leaves behind', () => {
  const EVIL = 'https://evil.test';

  test('does not point the FHIR console at the server the link named', async ({ page }) => {
    // The attack: someone with a session follows a link to /launch?iss=...
    // and then uses the app. The override used to stay in memory, so the
    // FHIR console sent the existing bearer token to the linked server.
    await stubDiscovery(page);
    await seedSession(page);

    const reachedEvil: { url: string; authorization?: string }[] = [];
    await page.route(`${EVIL}/**`, (route) => {
      reachedEvil.push({
        url: route.request().url(),
        authorization: route.request().headers()['authorization']
      });
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });

    let sentToBase: string | undefined;
    await page.route(`${FHIR_BASE}/Patient/**`, (route) => {
      sentToBase = route.request().headers()['authorization'];
      return route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'Patient', id: 'p' })
      });
    });

    await page.goto(`/launch?iss=${EVIL}/fhir&launch=abc`);
    await expect(page.getByText('FHIR base overridden for this session')).toBeVisible();
    await expect(
      page.getByText('This launch is for a different server than your session')
    ).toBeVisible();

    // Through the nav, not page.goto: a reload would drop the in-memory
    // override on its own and hide the bug this test is for.
    await page.getByRole('link', { name: 'FHIR API' }).first().click();
    await expect(page.getByRole('heading', { name: 'FHIR API' })).toBeVisible();
    await expect(page.getByText(/Send requests to/)).toContainText(FHIR_BASE);
    await expect(page.getByText(/Send requests to/)).not.toContainText('evil.test');

    await page.getByLabel('FHIR query').fill('Patient/p');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();

    expect(sentToBase).toBe('Bearer access-1');
    expect(reachedEvil.filter((r) => r.url.includes('/Patient'))).toEqual([]);
    expect(reachedEvil.filter((r) => r.authorization !== undefined)).toEqual([]);
  });

  test('does not leave its endpoints in place for the next launch', async ({ page }) => {
    // Discovery ran against the linked server. Those endpoints used to be
    // reused by whatever launch came next, since discovery only ran when
    // nothing was held at all.
    await stubDiscovery(page);
    await page.route(`${EVIL}/**`, (route) => {
      if (route.request().url().endsWith('/.well-known/smart-configuration')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...SMART_CONFIGURATION,
            issuer: EVIL,
            jwks_uri: `${EVIL}/jwks`,
            authorization_endpoint: `${EVIL}/authorize`,
            token_endpoint: `${EVIL}/token`
          })
        });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });

    await page.goto(`/launch?iss=${EVIL}/fhir&launch=abc`);
    await expect(page.getByText(`${EVIL}/authorize`)).toBeVisible();

    // The nav link reuses the page component, so nothing is destroyed here.
    await page.getByRole('link', { name: 'Launch' }).first().click();
    await expect(page).toHaveURL(/\/launch$/);
    await expect(page.getByText('EHR launch detected')).toHaveCount(0);
    await expect(page.getByText(`${EVIL}/authorize`)).toHaveCount(0);
    await expect(page.getByLabel(/Standalone launch/)).toBeChecked();

    await page.getByRole('button', { name: 'Preview the URL' }).click();
    const preview = page.locator('pre').filter({ hasText: '/authorize' });
    await expect(preview).toContainText(`${AUTH_ISSUER}/authorize`);
    await expect(preview).toContainText(`aud=${encodeURIComponent(FHIR_BASE)}`);
    await expect(preview).not.toContainText('evil.test');
  });

  test('says once that a scope typed twice is replaced', async ({ page }) => {
    await stubDiscovery(page);
    await page.route('**/swiss-env.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          fhirBaseUrl: FHIR_BASE,
          authIssuer: AUTH_ISSUER,
          clientId: 'e2e-client',
          clientSecret: '',
          scopes: 'openid launch/patient launch/patient'
        })
      })
    );
    await page.goto(`/launch?iss=${FHIR_BASE}&launch=abc`);
    await expect(page.getByText('Scope adjustment')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'launch/patient' })).toHaveCount(1);
  });
});
