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

import type { Page } from '@playwright/test';
import { expect, FHIR_BASE, seedSession, sessionRecord, stubDiscovery, test } from './fixtures';

/** In-app navigation, so in-memory state such as Diagnostics results survives. */
async function navTo(page: Page, label: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).click();
}

const picker = (page: Page) => page.getByTestId('environment-picker');

/** Makes an environment on the Config page; Swiss switches to it. */
async function createEnvironment(page: Page, name: string) {
  await navTo(page, 'Config');
  await page.getByRole('button', { name: 'New environment' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create and switch' }).click();
  await expect(picker(page)).toContainText(name);
}

async function pick(page: Page, name: string) {
  await picker(page).click();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('menuitemradio', { name: new RegExp(`^✓?\\s*${escaped}`) }).click();
  await expect(picker(page)).toContainText(name);
}

async function fill(page: Page, key: string, value: string) {
  const input = page.locator(`#config-${key}`);
  await input.fill(value);
  await input.blur();
}

/** Answers anything sent to the servers a blank environment points at. */
async function stubLocalServers(page: Page) {
  for (const host of ['http://localhost:8000/**', 'http://localhost:9200/**']) {
    await page.route(host, (route) => route.fulfill({ status: 404, body: 'not here' }));
  }
}

test.describe('switching environments', () => {
  test('parks the session and Diagnostics results, and brings them back', async ({ page }) => {
    await stubDiscovery(page);
    await stubLocalServers(page);
    await seedSession(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();

    await createEnvironment(page, 'Staging');
    await navTo(page, 'Session');
    await expect(page.getByRole('heading', { name: 'No active session' })).toBeVisible();
    await navTo(page, 'Diagnostics');
    await expect(page.getByRole('button', { name: 'Run checks' })).toBeVisible();

    await pick(page, 'Default');
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();
    await navTo(page, 'Session');
    await expect(page.getByRole('heading', { name: 'Access token lifetime' })).toBeVisible();
  });

  test('shows a dot for each session an environment holds', async ({ page }) => {
    await stubDiscovery(page);
    await stubLocalServers(page);
    await seedSession(page);
    await seedSession(page, { intent: { flavor: 'backend-services' } });
    await page.goto('/');
    await createEnvironment(page, 'Empty');

    await picker(page).click();
    await expect(
      page.getByRole('menuitemradio', { name: /Default.*Standalone, Backend/ })
    ).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: /Empty.*no sessions/ })).toBeVisible();
  });

  test('works from the keyboard', async ({ page }) => {
    await stubLocalServers(page);
    await page.goto('/');
    await createEnvironment(page, 'Keyboard');

    await picker(page).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: /^✓?\s*Keyboard/ })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('menuitemradio', { name: /^✓?\s*Default/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(picker(page)).toContainText('Default');
    await expect(picker(page)).toBeFocused();
  });
});

test.describe('launch types per environment', () => {
  test('each environment opens Launch in its own default, with its own Backend Services client', async ({
    page
  }) => {
    await stubDiscovery(page);
    await stubLocalServers(page);
    await page.goto('/');
    await createEnvironment(page, 'Backend job');
    await page.locator('#config-defaultLaunchType').selectOption('backend-services');
    await fill(page, 'backendClientId', 'job-client');

    await navTo(page, 'Launch');
    await expect(page.getByLabel(/Backend services/)).toBeChecked();
    await expect(page.getByText('job-client')).toBeVisible();
    // The other launch types stay available.
    await expect(page.getByLabel(/Standalone launch/)).toBeEnabled();

    await pick(page, 'Default');
    await expect(page.getByLabel(/Standalone launch/)).toBeChecked();
  });

  test('makes the launch type picked the default for the environment', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/launch');
    await page.getByLabel(/EHR launch/).check();
    await page.getByRole('button', { name: 'Make this the default' }).click();
    await expect(page.getByText('Default opens in EHR launch.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make this the default' })).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel(/EHR launch/)).toBeChecked();
  });

  test("offers to switch when an EHR launch names another environment's server", async ({
    page
  }) => {
    await stubDiscovery(page);
    await page.route('https://partner-fhir.test/**', (route) =>
      route.fulfill({ status: 404, body: 'not here' })
    );
    await stubLocalServers(page);
    await page.goto('/');
    await createEnvironment(page, 'Partner');
    await fill(page, 'fhirBaseUrl', 'https://partner-fhir.test');
    await pick(page, 'Default');

    await page.goto('/launch?iss=https%3A%2F%2Fpartner-fhir.test%2F&launch=abc');
    const offer = page.getByRole('button', { name: 'Switch to Partner' });
    await expect(offer).toBeVisible();
    await offer.click();
    await expect(picker(page)).toContainText('Partner');
    await expect(offer).toHaveCount(0);
    await expect(page.getByText('EHR launch detected')).toBeVisible();
  });
});

test.describe('what belongs to an environment', () => {
  test('saved FHIR headers stay with their environment', async ({ page }) => {
    await stubDiscovery(page);
    await stubLocalServers(page);
    await page.goto('/fhir');
    await page.getByRole('button', { name: 'Add a header' }).click();
    await page.getByLabel('Header name').fill('X-Api-Key');
    await page.getByLabel('Header value').fill('key-for-default');
    await page.getByLabel(/Store these headers in this browser/).check();

    await createEnvironment(page, 'Other');
    await navTo(page, 'FHIR API');
    await expect(page.getByLabel('Header value')).toHaveCount(0);

    await pick(page, 'Default');
    await expect(page.getByLabel('Header value')).toHaveValue('key-for-default');
  });

  test("the log shows this environment's requests unless asked for all", async ({ page }) => {
    await stubDiscovery(page);
    await stubLocalServers(page);
    await page.goto('/launch');
    await expect(page.getByText('Launch mode')).toBeVisible();
    await createEnvironment(page, 'Second');
    await navTo(page, 'Launch');

    await page.getByRole('button', { name: /Exchange log/ }).click();
    const drawer = page.getByRole('complementary', { name: 'Exchange log' });
    await expect(
      drawer.locator('details').filter({ hasText: 'localhost:8000' }).first()
    ).toBeVisible();
    await expect(drawer.locator('details').filter({ hasText: FHIR_BASE })).toHaveCount(0);

    await drawer.getByLabel('Environment').selectOption('all');
    await expect(drawer.locator('details').filter({ hasText: FHIR_BASE }).first()).toBeVisible();
    await expect(
      drawer.getByTestId('entry-environment').filter({ hasText: 'Default' }).first()
    ).toBeVisible();
  });

  test('deleting an environment removes it and what it stored, and leaves Default in use', async ({
    page
  }) => {
    await stubLocalServers(page);
    await page.goto('/');
    await createEnvironment(page, 'Doomed');
    const id = await page.evaluate(() => sessionStorage.getItem('swiss.envs.active.v1'));
    await page.evaluate(
      ([envId, session]) => {
        sessionStorage.setItem(`swiss.session.v1.${envId}.standalone`, session);
        localStorage.setItem(`persistCurrentHeaders.${envId}`, '[]');
      },
      [id ?? '', JSON.stringify(sessionRecord())] as const
    );

    const row = page.locator(`[data-environment-row="${id}"]`);
    await row.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete it' }).click();

    await expect(row).toHaveCount(0);
    await expect(picker(page)).toContainText('Default');
    const left = await page.evaluate(
      (envId) =>
        [...Object.keys(sessionStorage), ...Object.keys(localStorage)].filter((key) =>
          key.includes(envId)
        ),
      id ?? ''
    );
    expect(left).toEqual([]);
  });

  test('copying an environment keeps its settings and starts with no sessions', async ({
    page
  }) => {
    await stubDiscovery(page);
    await stubLocalServers(page);
    await seedSession(page);
    await page.goto('/config');
    await page
      .locator(`[data-environment-row="default"]`)
      .getByRole('button', { name: 'Duplicate' })
      .click();
    await pick(page, 'Default (copy)');
    await navTo(page, 'Config');
    await expect(page.locator('#config-fhirBaseUrl')).toHaveValue(FHIR_BASE);
    await navTo(page, 'Session');
    await expect(page.getByRole('heading', { name: 'No active session' })).toBeVisible();
  });
});

test.describe('Diagnostics for every launch type', () => {
  test('labels the checks that are about some launch types only', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();

    const backend = page.locator('details').filter({ hasText: 'Backend Services is supported' });
    await expect(backend.getByTestId('applies-to')).toHaveText('Backend Services');
    const pkce = page.locator('details').filter({ hasText: 'PKCE S256 is supported' });
    await expect(pkce.getByTestId('applies-to')).toHaveText('Standalone and EHR');
  });
});
