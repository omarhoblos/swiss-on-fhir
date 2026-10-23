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

import { exportJWK, generateKeyPair } from 'jose';
import type { Page } from '@playwright/test';
import { expect, stubDeploymentEnvironments, stubDiscovery, test } from './fixtures';

const picker = (page: Page) => page.getByTestId('environment-picker');

const PARTNER = {
  id: 'partner',
  name: 'Partner sandbox',
  settings: { fhirBaseUrl: 'https://partner.test', clientId: 'partner-client' }
};

async function pick(page: Page, name: string) {
  await picker(page).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^✓?\\s*${name}`) }).click();
  await expect(picker(page)).toContainText(name);
}

test.describe('environments shipped with the deployment', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://partner.test/**', (route) =>
      route.fulfill({ status: 404, body: 'not here' })
    );
  });

  test('appear read-only beside Default, and edits layer on top', async ({ page }) => {
    await stubDeploymentEnvironments(page, {
      swissEnvironmentsVersion: 1,
      environments: [PARTNER]
    });
    await page.goto('/config');

    const row = page.locator('[data-environment-row="deploy:partner"]');
    await expect(row.getByText('from the deployment file')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Rename' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0);

    await picker(page).click();
    const deploymentGroup = page.getByRole('group', { name: 'This deployment' });
    await expect(
      deploymentGroup.getByRole('menuitemradio', { name: /Partner sandbox/ })
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await pick(page, 'Partner sandbox');
    const fhir = page.locator('[data-config-field="fhirBaseUrl"]');
    await expect(fhir.locator('#config-fhirBaseUrl')).toHaveValue('https://partner.test');
    await expect(fhir.getByText('from deployment', { exact: true })).toBeVisible();

    const client = page.locator('[data-config-field="clientId"]');
    await client.locator('#config-clientId').fill('my-own-client');
    await client.locator('#config-clientId').blur();
    await expect(client.getByText('edited here', { exact: true })).toBeVisible();
    await client.getByRole('button', { name: 'Reset to deployment value' }).click();
    await expect(client.locator('#config-clientId')).toHaveValue('partner-client');

    // Reset edits, from the list, for an environment not in use.
    await client.locator('#config-clientId').fill('again');
    await client.locator('#config-clientId').blur();
    await pick(page, 'Default');
    await row.getByRole('button', { name: 'Reset edits' }).click();
    await pick(page, 'Partner sandbox');
    await expect(page.locator('#config-clientId')).toHaveValue('partner-client');
  });

  test('a first visit starts in the environment the file names', async ({ page }) => {
    await stubDeploymentEnvironments(page, {
      swissEnvironmentsVersion: 1,
      defaultEnvironment: 'partner',
      environments: [PARTNER]
    });
    await page.goto('/');
    await expect(picker(page)).toContainText('Partner sandbox');
  });

  test('problems in the file are listed, and secrets in it are warned about', async ({ page }) => {
    await stubDeploymentEnvironments(page, {
      swissEnvironmentsVersion: 1,
      environments: [
        { name: 'Broken', settings: { fhirBaseUrl: 'ftp://nope' } },
        { ...PARTNER, settings: { ...PARTNER.settings, clientSecret: 'shipped-secret' } }
      ]
    });
    await page.goto('/config');
    await expect(page.getByText("The deployment's environments file has problems")).toBeVisible();
    await expect(
      page.getByText(/“Broken” in \/swiss-environments\.json was not loaded/)
    ).toBeVisible();
    await expect(
      page.getByText("The deployment's environments file is served in plaintext")
    ).toBeVisible();
    await expect(page.locator('[data-environment-row="deploy:partner"]')).toBeVisible();
  });

  test("puts a shipped key in its environment's Backend Services slot", async ({ page }) => {
    await stubDiscovery(page);
    const pair = await generateKeyPair('ES384', { extractable: true });
    await stubDeploymentEnvironments(page, {
      swissEnvironmentsVersion: 1,
      environments: [
        {
          ...PARTNER,
          backendServicesKey: { ...(await exportJWK(pair.privateKey)), kid: 'shipped-key' }
        }
      ]
    });
    await page.goto('/config');
    await pick(page, 'Partner sandbox');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Launch' })
      .click();
    await page.getByLabel(/Backend services/).check();
    await expect(page.getByText('shipped-key', { exact: true })).toBeVisible();
    await expect(page.getByText('shipped with the deployment')).toBeVisible();
  });

  test('a tab whose environment is gone falls back to Default and says so', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('swiss.test.seeded')) return;
      sessionStorage.setItem('swiss.test.seeded', '1');
      sessionStorage.setItem('swiss.envs.active.v1', 'deploy:gone');
    });
    await page.goto('/config');
    await expect(picker(page)).toContainText('Default');
    await expect(
      page.getByText(/`deploy:gone`.*no longer available|deploy:gone/).first()
    ).toBeVisible();
  });
});
