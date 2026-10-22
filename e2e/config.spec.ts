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

import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test, RUNTIME_CONFIG, stubRuntimeConfig } from './fixtures';

/** Drops a file from outside the browser onto the import box, as the OS would. */
async function dropFile(page: Page, name: string, text: string) {
  const dataTransfer = await page.evaluateHandle(
    ([name, text]) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], name));
      return transfer;
    },
    [name, text]
  );
  const box = page.locator('#config-import');
  await box.dispatchEvent('dragover', { dataTransfer });
  await box.dispatchEvent('drop', { dataTransfer });
}

/**
 * The highest-value spec in the suite: it covers the whole configuration
 * system, which is the crux of the rewrite.
 */
test.describe('configuration', () => {
  test('loads .env values, overrides them live, persists, and resets', async ({ page }) => {
    await page.goto('/config');

    const fhirRow = page.locator('[data-config-field="fhirBaseUrl"]');
    const fhirInput = fhirRow.locator('#config-fhirBaseUrl');
    await expect(fhirInput).toHaveValue(RUNTIME_CONFIG.fhirBaseUrl);

    // Sourced from the runtime file, not a built-in default.
    await expect(fhirRow.getByText('from .env', { exact: true })).toBeVisible();

    // Override it live.
    await fhirInput.fill('https://override.test/baseR4');
    await fhirInput.blur();

    await expect(fhirRow.getByText('edited here', { exact: true })).toBeVisible();

    // Survives a reload.
    await page.reload();
    await expect(fhirRow.locator('#config-fhirBaseUrl')).toHaveValue(
      'https://override.test/baseR4'
    );
    await expect(fhirRow.getByText('edited here', { exact: true })).toBeVisible();

    // Per-field reset returns to the .env value, not a built-in default.
    await fhirRow.getByRole('button', { name: /Reset to \.env value/ }).click();
    await expect(fhirRow.locator('#config-fhirBaseUrl')).toHaveValue(RUNTIME_CONFIG.fhirBaseUrl);
    await expect(fhirRow.getByText('from .env', { exact: true })).toBeVisible();
  });

  test('resets each card from its header, and only that card', async ({ page }) => {
    await page.goto('/config');
    const resetDeployment = page.getByRole('button', { name: 'Reset all deployment settings' });
    const resetTesting = page.getByRole('button', { name: 'Reset all testing options' });
    await expect(resetDeployment).toHaveText('Reset All');
    await expect(resetTesting).toHaveText('Reset All');
    await expect(resetDeployment).toBeDisabled();
    await expect(resetTesting).toBeDisabled();

    const fhirRow = page.locator('[data-config-field="fhirBaseUrl"]');
    const fhirInput = fhirRow.locator('#config-fhirBaseUrl');
    const clientInput = page.locator('#config-clientId');
    const authMethod = page.locator('#config-clientAuthMethod');

    await fhirInput.fill('https://override.test/baseR4');
    await fhirInput.blur();
    await clientInput.fill('edited-client');
    await clientInput.blur();
    await authMethod.selectOption('basic');

    // A rejected edit leaves its message under the field until the value changes.
    await fhirInput.fill('not a url');
    await fhirInput.blur();
    await expect(fhirRow.locator('.text-error')).toBeVisible();

    await resetDeployment.click();
    await expect(fhirInput).toHaveValue(RUNTIME_CONFIG.fhirBaseUrl);
    await expect(fhirRow.getByText('from .env', { exact: true })).toBeVisible();
    await expect(fhirRow.locator('.text-error')).toHaveCount(0);
    await expect(clientInput).toHaveValue(RUNTIME_CONFIG.clientId);
    await expect(resetDeployment).toBeDisabled();

    // Testing options are not deployment settings, so they keep their edit
    // until their own card is reset.
    await expect(authMethod).toHaveValue('basic');
    await resetTesting.click();
    await expect(authMethod).toHaveValue('none');
    await expect(resetTesting).toBeDisabled();
  });

  test('downloads the configuration as timestamped JSON and .env files', async ({ page }) => {
    await page.goto('/config');
    const stamp = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}`;

    const [json] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download as JSON' }).click()
    ]);
    expect(json.suggestedFilename()).toMatch(new RegExp(`^swiss-config-${stamp}\\.json$`));
    const exported = JSON.parse(readFileSync(await json.path(), 'utf8'));
    expect(exported.clientId).toBe(RUNTIME_CONFIG.clientId);
    expect(exported).not.toHaveProperty('clientSecret');

    const [env] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download as .env' }).click()
    ]);
    expect(env.suggestedFilename()).toMatch(new RegExp(`^swiss-config-${stamp}\\.env$`));
    const dotEnv = readFileSync(await env.path(), 'utf8');
    expect(dotEnv).toContain(`CLIENT_ID=${RUNTIME_CONFIG.clientId}\n`);
    // Left out, not written empty: importing CLIENT_SECRET= would clear a saved secret.
    expect(dotEnv).not.toMatch(/^CLIENT_SECRET=/m);
  });

  test('loads a dropped .env file into the import box, then imports it', async ({ page }) => {
    await page.goto('/config');
    const box = page.locator('#config-import');
    const text = 'CLIENT_ID=dropped-client\nFRAME_ANCESTORS=self\n';

    await dropFile(page, 'staging.env', text);
    await expect(box).toHaveValue(text);
    await expect(page.getByTestId('import-file')).toContainText('staging.env');
    // Loading a file applies nothing until Import is pressed.
    await expect(page.locator('#config-clientId')).toHaveValue(RUNTIME_CONFIG.clientId);

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('#config-clientId')).toHaveValue('dropped-client');
    await expect(page.getByText('Applied 1 setting(s).')).toBeVisible();
    await expect(page.getByText(/FRAME_ANCESTORS is set when the container starts/)).toBeVisible();
    await expect(box).toHaveValue('');
  });

  test('loads a dropped .json export', async ({ page }) => {
    await page.goto('/config');
    await dropFile(page, 'export.json', '{ "clientId": "from-json" }');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('#config-clientId')).toHaveValue('from-json');
  });

  test('shows a whole JSON export in the import box without scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/config');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download as JSON' }).click()
    ]);
    // On a phone the scopes line wraps, so the box must fit wrapped lines too.
    await dropFile(page, 'export.json', readFileSync(await download.path(), 'utf8'));
    const box = page.locator('#config-import');
    await expect(box).toHaveValue(/"swissConfigVersion"/);
    await expect
      .poll(() => box.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeLessThanOrEqual(0);
  });

  test('refuses a dropped file that is not .json or .env', async ({ page }) => {
    await page.goto('/config');
    const box = page.locator('#config-import');
    await box.fill('CLIENT_ID=typed');

    await dropFile(page, 'notes.txt', 'CLIENT_ID=from-txt');
    await expect(page.getByText('notes.txt is not a .json or .env file')).toBeVisible();
    await expect(box).toHaveValue('CLIENT_ID=typed');
  });

  test('shows the derived redirect URI to register', async ({ page }) => {
    await page.goto('/config');
    await expect(page.getByText('http://localhost:4173/callback').first()).toBeVisible();
  });

  test('reports a broken runtime config without a white screen', async ({ page }) => {
    // The anti-white-screen guarantee: a JS config file with a syntax error
    // was unrecoverable in 2.x, which is why this is JSON now.
    await stubRuntimeConfig(page, '{ "authIssuer": ');
    await page.goto('/config');

    await expect(page.getByText(/could not be loaded/i)).toBeVisible();
    await expect(page.getByText(/not valid JSON/i)).toBeVisible();
    // And the editor is still usable, so the user can fix it here.
    await expect(page.locator('#config-fhirBaseUrl')).toBeVisible();
  });

  test('explains an unsubstituted placeholder as an unrendered config file', async ({ page }) => {
    // The exact Docker regression from 2.x: the template shipped unrendered.
    await stubRuntimeConfig(page, {
      fhirBaseUrl: '${FHIRENDPOINT_URI}',
      authIssuer: '${ISSUER_URI}',
      clientId: '${CLIENT_ID}',
      clientSecret: '',
      scopes: '${SCOPES}'
    });
    await page.goto('/config');
    await expect(page.getByText(/swiss-env\.json was never rendered/i).first()).toBeVisible();
  });

  test('accepts a 2.x .env and reports the removed keys as safe to delete', async ({ page }) => {
    await stubRuntimeConfig(page, {
      ...RUNTIME_CONFIG,
      redirectUri: 'http://localhost:4173/index.html',
      logoutUri: 'https://idp.test/logout',
      requireHttps: 'false',
      strictDiscoveryDocumentValidation: 'true',
      skipIssuerCheck: 'false'
    });
    await page.goto('/config');

    // Still loads, with the real values applied.
    await expect(page.locator('#config-fhirBaseUrl')).toHaveValue(RUNTIME_CONFIG.fhirBaseUrl);
    const ignored = page.locator('section', { hasText: 'Ignored settings' });
    await expect(ignored).toBeVisible();
    for (const key of ['redirectUri', 'logoutUri', 'requireHttps', 'skipIssuerCheck']) {
      await expect(ignored.getByText(key, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(/safe to delete/i).first()).toBeVisible();
  });
});

test.describe('the FRAME_ANCESTORS setting', () => {
  const card = (page: import('@playwright/test').Page) =>
    page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Swiss FRAME_ANCESTOR Setting', exact: true })
    });

  test("shows the server's frame-ancestors, read-only", async ({ page }) => {
    // As the container sends it: on the same response as the settings.
    await page.route('**/swiss-env.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-security-policy': "frame-ancestors 'self' https://ehr.test" },
        body: JSON.stringify(RUNTIME_CONFIG)
      })
    );
    await page.goto('/config');

    await expect(card(page).getByTestId('frame-ancestors').locator('code')).toHaveText([
      "'self'",
      'https://ehr.test'
    ]);
    await expect(card(page)).toContainText(
      'Swiss itself and the sites listed may show Swiss in a frame'
    );
    // Nothing to edit: no inputs, and it says where it is set.
    await expect(card(page).getByRole('textbox')).toHaveCount(0);
    await expect(card(page)).toContainText(
      'Configured at deployment time. Cannot be set in the UI.'
    );
    const docs = card(page).getByRole('link', { name: 'Container documentation' });
    await expect(docs).toHaveAttribute('href', '/how-it-works#container');
  });

  test('explains Swiss-only framing', async ({ page }) => {
    await page.route('**/swiss-env.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-security-policy': "frame-ancestors 'self'" },
        body: JSON.stringify(RUNTIME_CONFIG)
      })
    );
    await page.goto('/config');
    await expect(card(page)).toContainText('Only Swiss itself.');
  });

  test('says when the server sends none, as the development server does', async ({ page }) => {
    await page.goto('/config');
    await expect(card(page)).toContainText(
      'This server sends no frame-ancestors, so any site may show Swiss in a frame.'
    );
    await expect(card(page).getByTestId('frame-ancestors')).toHaveCount(0);
  });
});
