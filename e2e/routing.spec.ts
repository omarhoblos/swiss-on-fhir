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

import { expect, test, FHIR_BASE, stubDiscovery } from './fixtures';

/**
 * Redirect-URI compatibility. Existing Swiss client registrations point at
 * three different landing shapes, and all of them must keep working.
 */
test.describe('callback routing', () => {
  test('forwards OAuth parameters from an unknown path to the callback', async ({ page }) => {
    await page.goto('/index.html?code=abc&state=xyz');
    await expect(page).toHaveURL(/\/callback/);
    // No pending transaction in this tab, which is reported precisely.
    await expect(page.getByText(/could not be processed/i)).toBeVisible();
  });

  test('sends an unknown path with no OAuth parameters to the home page', async ({ page }) => {
    // Reproduces Angular's { path: '**', redirectTo: '' }.
    await page.goto('/no-such-page');
    await expect(page).toHaveURL('http://localhost:4173/');
    await expect(page.getByRole('heading', { name: 'Session', exact: true })).toBeVisible();
  });

  test('redirects the legacy /fhirdata route to /fhir', async ({ page }) => {
    await page.goto('/fhirdata');
    await expect(page).toHaveURL(/\/fhir$/);
    await expect(page.getByRole('heading', { name: 'FHIR API' })).toBeVisible();
  });

  test('strips the authorization code from the URL', async ({ page }) => {
    // Codes are single-use, so leaving one in the URL means a reload
    // re-sends it and the server answers invalid_grant.
    await page.goto('/callback?code=abc&state=xyz');
    await expect(page).toHaveURL('http://localhost:4173/callback');
  });

  test('shows an unmatched error without linking a javascript: error_uri', async ({ page }) => {
    // Anyone can open /callback?error=...: the page must neither treat it as
    // the server's verdict on a real launch nor turn error_uri into a link
    // that runs script on this origin.
    await page.goto(
      '/callback?error=access_denied&error_description=nope&error_uri=javascript:alert(1)'
    );
    await expect(
      page.getByRole('heading', { name: 'The server refused the authorization' })
    ).toBeVisible();
    await expect(
      page.getByText('This error did not come from a launch this tab started')
    ).toBeVisible();
    // Shown as text, never as an anchor.
    await expect(page.getByText('javascript:alert(1)')).toBeVisible();
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  });

  test('links an http(s) error_uri', async ({ page }) => {
    await page.goto('/callback?error=server_error&error_uri=https://idp.test/errors/42');
    const link = page.getByRole('link', { name: 'https://idp.test/errors/42' });
    await expect(link).toHaveAttribute('href', 'https://idp.test/errors/42');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('keeps config and diagnostics reachable without a session', async ({ page }) => {
    // The old nav hid these behind authentication, which was backwards:
    // they are exactly what you need before auth works.
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });

    await nav.getByRole('link', { name: 'Config', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();

    await nav.getByRole('link', { name: 'Diagnostics', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();

    // Session-gated links are dimmed but present, so a new user can see the
    // features exist. The Angular nav hid them entirely.
    const fhirLink = nav.getByRole('link', { name: 'FHIR API', exact: true });
    await expect(fhirLink).toBeVisible();
    await expect(fhirLink).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('EHR launch routing', () => {
  test('forwards iss and launch from the bare origin to /launch', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto(`/?iss=${encodeURIComponent(FHIR_BASE)}&launch=abc123`);

    await expect(page).toHaveURL(
      `http://localhost:4173/launch?iss=${encodeURIComponent(FHIR_BASE)}&launch=abc123`
    );
    await expect(page.getByRole('heading', { name: 'EHR launch detected' })).toBeVisible();
    await expect(page.getByText('abc123')).toBeVisible();
  });

  test('leaves the Session page alone without launch parameters', async ({ page }) => {
    await page.goto('/?foo=bar');
    await expect(page).toHaveURL('http://localhost:4173/?foo=bar');
    await expect(page.getByRole('heading', { name: 'Session', exact: true })).toBeVisible();
  });
});
