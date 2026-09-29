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

// That the copied URL then completes a launch is covered in flow.spec.ts.
test.describe('previewing an EHR launch', () => {
  const launchUrl = `/launch?iss=${FHIR_BASE}&launch=abc`;

  test('offers a copy button beside the authorization URL', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto(launchUrl);
    await expect(page.getByLabel(/EHR launch/)).toBeChecked();

    // Nothing to copy until the URL has been built.
    await expect(page.getByRole('button', { name: 'Copy URL' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Preview the URL' }).click();
    await expect(page.getByText('Authorization URL')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy URL' })).toBeVisible();
  });

  test('copies the URL exactly as shown', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Clipboard permissions can only be granted in Chromium');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubDiscovery(page);
    await page.goto(launchUrl);

    await page.getByRole('button', { name: 'Preview the URL' }).click();
    const shown = await page.locator('pre').filter({ hasText: '/authorize' }).innerText();

    await page.getByRole('button', { name: 'Copy URL' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(shown.trim());
    expect(copied).toContain(`${AUTH_ISSUER}/authorize?`);
    expect(copied).toContain('launch=abc');
    // An EHR launch asks for `launch`, not `launch/patient`.
    expect(new URL(copied).searchParams.get('scope')?.split(' ')).toContain('launch');
  });
});

test.describe('registering Swiss with an EHR', () => {
  const ORIGIN = 'http://localhost:4173';

  test('shows the launch URL and redirect URI once EHR launch is selected', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/launch');

    // Not for a standalone launch: nothing launches Swiss in that case.
    await expect(page.getByText('Register Swiss with the EHR')).toHaveCount(0);

    await page.getByLabel(/EHR launch/).check();
    await expect(page.getByText('Register Swiss with the EHR')).toBeVisible();
    await expect(page.getByTestId('launch-url')).toHaveText(`${ORIGIN}/launch`);
    await expect(page.getByTestId('redirect-uri')).toHaveText(`${ORIGIN}/callback`);
    await expect(page.getByRole('button', { name: 'Copy launch URL' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy redirect URI' })).toBeVisible();

    await page.getByLabel(/Backend services/).check();
    await expect(page.getByText('Register Swiss with the EHR')).toHaveCount(0);
  });

  test('shows them when the EHR has already launched Swiss', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto(`/launch?iss=${FHIR_BASE}&launch=abc`);
    // The launch URL is the bare address, without this launch's parameters.
    await expect(page.getByTestId('launch-url')).toHaveText(`${ORIGIN}/launch`);
  });

  test('the launch URL it gives is one that starts an EHR launch', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/launch');
    await page.getByLabel(/EHR launch/).check();
    const launchUrl = await page.getByTestId('launch-url').innerText();

    // What an EHR does with it.
    await page.goto(`${launchUrl}?iss=${encodeURIComponent(FHIR_BASE)}&launch=from-the-ehr`);
    await expect(page.getByText('EHR launch detected')).toBeVisible();
    await expect(page.getByText('from-the-ehr')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start launch' })).toBeEnabled();
  });

  test('copies the launch URL', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Clipboard permissions can only be granted in Chromium');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubDiscovery(page);
    await page.goto('/launch');
    await page.getByLabel(/EHR launch/).check();

    await page.getByRole('button', { name: 'Copy launch URL' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ORIGIN}/launch`);
  });
});

test.describe('discovery when the Launch page opens', () => {
  /** Counts requests for the SMART discovery document. */
  async function countDiscovery(page: import('@playwright/test').Page) {
    const seen = { count: 0 };
    await page.route(`${FHIR_BASE}/.well-known/smart-configuration`, (route) => {
      seen.count += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SMART_CONFIGURATION)
      });
    });
    return seen;
  }

  const endpointRow = (page: import('@playwright/test').Page) =>
    page
      .locator('dt', { hasText: 'Authorization endpoint' })
      .locator('xpath=following-sibling::dd');

  test('fills in the authorization endpoint without being asked', async ({ page }) => {
    await stubDiscovery(page);
    const seen = await countDiscovery(page);

    await page.goto('/launch');

    await expect(endpointRow(page)).toHaveText(`${AUTH_ISSUER}/authorize`);
    await expect(page.getByText('No authorization endpoint was discovered')).toHaveCount(0);
    expect(seen.count).toBe(1);
  });

  test('does not fetch again for a preview, a start, or a return to the page', async ({ page }) => {
    await stubDiscovery(page);
    const seen = await countDiscovery(page);

    await page.goto('/launch');
    await expect(endpointRow(page)).toHaveText(`${AUTH_ISSUER}/authorize`);

    await page.getByRole('button', { name: 'Preview the URL' }).click();
    await expect(page.getByText('Authorization URL')).toBeVisible();

    await page.getByRole('link', { name: 'Config' }).first().click();
    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    await page.getByRole('link', { name: 'Launch' }).first().click();
    await expect(endpointRow(page)).toHaveText(`${AUTH_ISSUER}/authorize`);

    expect(seen.count).toBe(1);
  });

  test('shares one discovery with a launch started while it is still running', async ({ page }) => {
    await stubDiscovery(page);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let count = 0;
    await page.route(`${FHIR_BASE}/.well-known/smart-configuration`, async (route) => {
      count += 1;
      await held;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SMART_CONFIGURATION)
      });
    });

    await page.goto('/launch');
    await expect(page.getByText(/Reading the discovery documents/)).toBeVisible();
    await page.getByRole('button', { name: 'Preview the URL' }).click();
    release();

    await expect(page.locator('pre').filter({ hasText: '/authorize' })).toContainText(
      `${AUTH_ISSUER}/authorize`
    );
    expect(count).toBe(1);
  });

  test('discovers again after the configuration changes', async ({ page }) => {
    await stubDiscovery(page);
    const seen = await countDiscovery(page);
    await page.route('https://other-fhir.test/**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    );

    await page.goto('/launch');
    await expect(endpointRow(page)).toHaveText(`${AUTH_ISSUER}/authorize`);
    expect(seen.count).toBe(1);

    await page.getByRole('link', { name: 'Config' }).first().click();
    const base = page.locator('#config-fhirBaseUrl');
    await base.fill('https://other-fhir.test');
    await base.blur();
    const other = page.waitForRequest('https://other-fhir.test/.well-known/smart-configuration');
    await page.getByRole('link', { name: 'Launch' }).first().click();
    await other;
  });

  test('says so when nothing names an authorization endpoint', async ({ page }) => {
    for (const url of [`${FHIR_BASE}/**`, `${AUTH_ISSUER}/**`]) {
      await page.route(url, (route) =>
        route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
      );
    }

    await page.goto('/launch');

    await expect(page.getByText('No authorization endpoint was discovered')).toBeVisible();
    await expect(endpointRow(page)).toHaveText('not discovered');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test.describe('an EHR launch only uses what its own server publishes', () => {
  const EHR = 'https://ehr.test';
  type Page = import('@playwright/test').Page;

  /** Records every request to the configured authorization server. */
  async function watchConfiguredIssuer(page: Page) {
    const seen: string[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(AUTH_ISSUER)) seen.push(request.url());
    });
    return seen;
  }

  const endpointRow = (page: Page) =>
    page
      .locator('dt', { hasText: 'Authorization endpoint' })
      .locator('xpath=following-sibling::dd');

  test('does not fall back to the configured server when the launch server is unreadable', async ({
    page
  }) => {
    // The case that sent a launch from one EHR to another's authorization
    // server: discovery against `iss` failed, so the configured issuer's
    // endpoints were used, with the launch token and aud of the first.
    await stubDiscovery(page);
    const configured = await watchConfiguredIssuer(page);
    await page.route(`${EHR}/**`, (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    );

    await page.goto(`/launch?iss=${EHR}/fhir&launch=abc`);

    await expect(
      page.getByText("The launch's server published no authorization endpoint")
    ).toBeVisible();
    await expect(page.getByText(/was not\s+asked instead/)).toBeVisible();
    await expect(endpointRow(page)).toHaveText('not discovered');
    expect(configured).toEqual([]);

    // Starting it says why, and goes nowhere.
    await page.getByRole('button', { name: 'Start launch' }).click();
    await expect(page.getByText('Could not start the launch')).toBeVisible();
    await expect(page.getByText(/will not send the launch to the configured/)).toBeVisible();
    await expect(page).toHaveURL(/\/launch\?iss=/);
    expect(configured).toEqual([]);
  });

  test('uses the endpoints of a launch server that names no issuer', async ({ page }) => {
    // `issuer` is optional in smart-configuration. Its absence is not a
    // reason to ask the configured server either.
    await stubDiscovery(page);
    const configured = await watchConfiguredIssuer(page);
    await page.route(`${EHR}/**`, (route) => {
      if (route.request().url().endsWith('/.well-known/smart-configuration')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            authorization_endpoint: `${EHR}/auth/authorize`,
            token_endpoint: `${EHR}/auth/token`,
            capabilities: ['launch-ehr', 'client-public'],
            code_challenge_methods_supported: ['S256']
          })
        });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });

    await page.goto(`/launch?iss=${EHR}/fhir&launch=abc`);

    await expect(endpointRow(page)).toHaveText(`${EHR}/auth/authorize`);
    await page.getByRole('button', { name: 'Preview the URL' }).click();
    const preview = page.locator('pre').filter({ hasText: '/authorize' });
    await expect(preview).toContainText(`${EHR}/auth/authorize`);
    await expect(preview).toContainText(`aud=${encodeURIComponent(`${EHR}/fhir`)}`);
    expect(configured).toEqual([]);
  });

  test('follows the issuer the launch server declares', async ({ page }) => {
    await stubDiscovery(page);
    await page.route(`${EHR}/**`, (route) => {
      if (route.request().url().endsWith('/.well-known/smart-configuration')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...SMART_CONFIGURATION, issuer: AUTH_ISSUER })
        });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    const asked = page.waitForRequest(`${AUTH_ISSUER}/.well-known/openid-configuration`);

    await page.goto(`/launch?iss=${EHR}/fhir&launch=abc`);

    await asked;
    await expect(endpointRow(page)).toHaveText(`${AUTH_ISSUER}/authorize`);
  });

  test('still uses the configured server when the launch names the configured FHIR base', async ({
    page
  }) => {
    // Here the configuration is about the very server the launch named, so
    // what it says about that server's authorization server applies.
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/.well-known/smart-configuration`, (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    );

    await page.goto(`/launch?iss=${FHIR_BASE}&launch=abc`);

    await expect(endpointRow(page)).toHaveText(`${AUTH_ISSUER}/authorize`);
    await expect(
      page.getByText("The launch's server published no authorization endpoint")
    ).toHaveCount(0);
  });

  test('a standalone launch still falls back to the configured server', async ({ page }) => {
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/.well-known/smart-configuration`, (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    );

    await page.goto('/launch');

    await expect(endpointRow(page)).toHaveText(`${AUTH_ISSUER}/authorize`);
  });
});

test.describe('launch scopes follow the kind of launch', () => {
  type Page = import('@playwright/test').Page;
  const scopeRow = (page: Page) =>
    page.locator('dt', { hasText: /^scope$/ }).locator('xpath=following-sibling::dd');

  async function previewedScope(page: Page) {
    await page.getByRole('button', { name: 'Preview the URL' }).click();
    const url = await page.locator('pre').filter({ hasText: '/authorize' }).innerText();
    return new URL(url.trim()).searchParams.get('scope');
  }

  test('a standalone launch leaves `launch` out and says so', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/launch');

    await expect(scopeRow(page)).toHaveText(
      'openid fhirUser offline_access launch/patient patient/*.read'
    );
    await expect(page.getByText('Scope adjustment')).toBeVisible();
    const note = page.getByRole('listitem').filter({ hasText: 'left out' });
    await expect(note).toHaveCount(1);
    // Rendered as code, not as literal backticks.
    await expect(note.locator('code')).toHaveText('launch');
    await expect(note).not.toContainText('`');

    expect(await previewedScope(page)).toBe(
      'openid fhirUser offline_access launch/patient patient/*.read'
    );
  });

  test('an EHR launch sends `launch` once, without `launch/patient`', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto(`/launch?iss=${FHIR_BASE}&launch=abc`);

    await expect(scopeRow(page)).toHaveText('openid fhirUser offline_access launch patient/*.read');
    await expect(page.getByRole('listitem').filter({ hasText: 'replaced with' })).toHaveCount(1);
    expect(await previewedScope(page)).toBe('openid fhirUser offline_access launch patient/*.read');
  });

  test('switching the launch mode switches the scopes', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/launch');
    await expect(scopeRow(page)).toContainText('launch/patient');

    await page.getByLabel(/EHR launch/).check();
    await expect(scopeRow(page)).toHaveText('openid fhirUser offline_access launch patient/*.read');

    await page.getByLabel(/Standalone launch/).check();
    await expect(scopeRow(page)).toHaveText(
      'openid fhirUser offline_access launch/patient patient/*.read'
    );
  });

  test('verbatim sends the configured scopes unchanged, for either launch', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/launch');
    await page.getByLabel(/Send my scopes verbatim/).check();

    const configured = 'openid fhirUser offline_access launch launch/patient patient/*.read';
    await expect(scopeRow(page)).toHaveText(configured);
    expect(await previewedScope(page)).toBe(configured);

    await page.getByLabel(/EHR launch/).check();
    await expect(scopeRow(page)).toHaveText(configured);
  });

  test('says nothing when the configured scopes need no adjusting', async ({ page }) => {
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
          scopes: 'openid launch/patient patient/*.read'
        })
      })
    );
    await page.goto('/launch');
    await expect(scopeRow(page)).toHaveText('openid launch/patient patient/*.read');
    await expect(page.getByText('Scope adjustment')).toHaveCount(0);
  });
});
