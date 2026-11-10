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
import {
  expect,
  FHIR_BASE,
  RUNTIME_CONFIG,
  seedSession,
  stubDiscovery,
  stubRuntimeConfig,
  test
} from './fixtures';

/** In-app navigation, so in-memory state such as responses survives. */
async function navTo(page: Page, label: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).click();
}

const picker = (page: Page) => page.getByTestId('environment-picker');
const tabs = (page: Page) => page.getByRole('tab');
const selectedTab = (page: Page) => page.getByRole('tab', { selected: true });
const queryBox = (page: Page) => page.getByLabel('FHIR query');

async function createEnvironment(page: Page, name: string) {
  await navTo(page, 'Config');
  await page.getByRole('button', { name: 'New environment' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create and switch' }).click();
  await expect(picker(page)).toContainText(name);
}

async function pick(page: Page, name: string) {
  await picker(page).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^✓?\\s*${name}`) }).click();
  await expect(picker(page)).toContainText(name);
}

/** Answers FHIR requests with a one-entry Bundle, after `delayMs`. */
async function stubFhir(page: Page, delayMs = 0) {
  await page.route(`${FHIR_BASE}/Patient**`, async (route) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/fhir+json',
      body: JSON.stringify({ resourceType: 'Bundle', type: 'searchset', total: 1 })
    });
  });
  // A blank environment points at the local test bed's ports; nothing answers there.
  for (const host of ['http://localhost:8000/**', 'http://localhost:9200/**']) {
    await page.route(host, (route) => route.fulfill({ status: 404, body: 'not here' }));
  }
}

async function send(page: Page, query: string) {
  await queryBox(page).fill(query);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test.describe('request tabs', () => {
  test('choosing a tab switches the environment, and each tab keeps its request and response', async ({
    page
  }) => {
    await stubDiscovery(page);
    await stubFhir(page);
    await seedSession(page);
    await page.goto('/fhir');
    await expect(tabs(page)).toHaveCount(1);
    await send(page, 'Patient');
    await expect(page.getByText('200', { exact: true })).toBeVisible();

    // The Default tab has a request in it, so Staging gets a tab of its own.
    await createEnvironment(page, 'Staging');
    await navTo(page, 'FHIR API');
    await expect(tabs(page)).toHaveCount(2);
    await expect(selectedTab(page)).toContainText('Staging');
    await expect(queryBox(page)).toHaveValue('');
    await expect(page.getByText('No request sent yet.')).toBeVisible();

    await page.getByRole('tab', { name: /Default/ }).click();
    await expect(picker(page)).toContainText('Default');
    await expect(queryBox(page)).toHaveValue('Patient');
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    await expect(page.getByTestId('token-slot')).toBeVisible();

    // The picker brings up the environment's tab rather than moving this one.
    await pick(page, 'Staging');
    await expect(selectedTab(page)).toContainText('Staging');
    await expect(tabs(page)).toHaveCount(2);
    await expect(page.getByRole('tab', { name: /Default/ })).toContainText('GET Patient');
  });

  test('an untouched tab moves to the environment chosen in the nav', async ({ page }) => {
    await stubDiscovery(page);
    await stubFhir(page);
    await page.goto('/fhir');
    await expect(selectedTab(page)).toContainText('Default');

    await createEnvironment(page, 'Staging');
    await navTo(page, 'FHIR API');
    await expect(tabs(page)).toHaveCount(1);
    await expect(selectedTab(page)).toContainText('Staging');
  });

  test('"New tab" offers every environment, and opens on the one chosen', async ({ page }) => {
    await stubDiscovery(page);
    await stubFhir(page);
    await page.goto('/fhir');
    await createEnvironment(page, 'Staging');
    await navTo(page, 'FHIR API');

    await page.getByRole('button', { name: '+ New tab' }).click();
    await page.getByRole('menuitem', { name: 'Default' }).click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(selectedTab(page)).toContainText('Default');
    await expect(picker(page)).toContainText('Default');
  });

  test('a response lands in the tab that sent it', async ({ page }) => {
    await stubDiscovery(page);
    await stubFhir(page, 800);
    await seedSession(page);
    await page.goto('/fhir');
    await send(page, 'Patient?name=slow');
    await page.getByRole('button', { name: '+ New tab' }).click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(page.getByRole('tab', { name: /Patient\?name=slow/ })).toContainText('(sending)');
    await expect(page.getByText('No request sent yet.')).toBeVisible();

    await page.getByRole('tab', { name: /Patient\?name=slow/ }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();
  });

  test('drafts and names survive a reload, responses do not', async ({ page, context }) => {
    await stubDiscovery(page);
    await stubFhir(page);
    await page.goto('/fhir');
    await send(page, 'Patient?name=smith');
    await expect(page.getByText('200', { exact: true })).toBeVisible();

    await selectedTab(page).dblclick();
    const name = page.getByRole('textbox', { name: 'Name this tab' });
    await name.fill('x'.repeat(80));
    await expect(name).toHaveValue('x'.repeat(64));
    await name.fill('Smiths');
    await name.press('Enter');
    await expect(selectedTab(page)).toContainText('Smiths');

    await page.reload();
    await expect(selectedTab(page)).toContainText('Smiths');
    await expect(queryBox(page)).toHaveValue('Patient?name=smith');
    await expect(page.getByText('No request sent yet.')).toBeVisible();

    // A new browser tab starts from the last set any tab wrote.
    const other = await context.newPage();
    await stubRuntimeConfig(other, RUNTIME_CONFIG);
    await stubDiscovery(other);
    await other.goto('/fhir');
    await expect(other.getByRole('tab', { selected: true })).toContainText('Smiths');
    await expect(other.getByLabel('FHIR query')).toHaveValue('Patient?name=smith');
  });

  test('tabs work from the keyboard', async ({ page }) => {
    await stubDiscovery(page);
    await stubFhir(page);
    await page.goto('/fhir');
    await queryBox(page).fill('first');
    await page.getByRole('button', { name: '+ New tab' }).click();
    await queryBox(page).fill('second');
    await expect(tabs(page)).toHaveCount(2);

    // Arrows move focus without choosing; Enter chooses.
    await selectedTab(page).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: /first/ })).toBeFocused();
    await expect(queryBox(page)).toHaveValue('second');
    await page.keyboard.press('Enter');
    await expect(queryBox(page)).toHaveValue('first');

    // F2 names the focused tab; Escape keeps the old name.
    await page.keyboard.press('F2');
    await page.getByRole('textbox', { name: 'Name this tab' }).fill('not kept');
    await page.keyboard.press('Escape');
    await expect(selectedTab(page)).toContainText('GET first');
    await expect(selectedTab(page)).toBeFocused();

    // Delete closes the focused tab; closing the last leaves an empty one.
    await page.keyboard.press('Delete');
    await expect(tabs(page)).toHaveCount(1);
    await expect(queryBox(page)).toHaveValue('second');
    await selectedTab(page).focus();
    await page.keyboard.press('Delete');
    await expect(tabs(page)).toHaveCount(1);
    await expect(selectedTab(page)).toContainText('New request');
  });

  test('tabs are reordered by dragging, and from the keyboard', async ({ page }) => {
    await stubDiscovery(page);
    await stubFhir(page);
    await page.goto('/fhir');
    for (const query of ['one', 'two', 'three']) {
      if (query !== 'one') await page.getByRole('button', { name: '+ New tab' }).click();
      await queryBox(page).fill(query);
    }
    const order = () => page.getByTestId('request-tab-title').allInnerTexts();
    await expect.poll(order).toEqual(['GET one', 'GET two', 'GET three']);

    // Dropped on the left half of the first tab: it goes before it.
    const first = page.getByRole('tab', { name: /GET one/ });
    const box = (await first.boundingBox())!;
    await page
      .getByRole('tab', { name: /GET three/ })
      .dragTo(first, { targetPosition: { x: 4, y: box.height / 2 } });
    await expect.poll(order).toEqual(['GET three', 'GET one', 'GET two']);
    // Dragging does not choose a tab.
    await expect(queryBox(page)).toHaveValue('three');

    await page.getByRole('tab', { name: /GET three/ }).focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(order).toEqual(['GET one', 'GET three', 'GET two']);
    await expect(page.getByRole('tab', { name: /GET three/ })).toBeFocused();

    // The order is kept across a reload.
    await page.reload();
    await expect.poll(order).toEqual(['GET one', 'GET three', 'GET two']);
  });

  test('a stored set that cannot be trusted is not used', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'swiss.requests.v1',
        JSON.stringify({
          swissRequestTabsVersion: 1,
          selectedId: 'aaaaaaaa',
          tabs: [
            {
              id: 'aaaaaaaa',
              environmentId: '<img src=x onerror="window.__pwned=1">',
              name: 'Bad',
              method: 'GET',
              query: 'x',
              body: ''
            },
            {
              id: 'bbbbbbbb',
              environmentId: 'default',
              name: '<b>ok</b>',
              method: 'GET',
              query: 'y',
              body: ''
            }
          ]
        })
      );
    });
    await stubDiscovery(page);
    await page.goto('/fhir');
    await expect(tabs(page)).toHaveCount(1);
    await expect(selectedTab(page)).toContainText('<b>ok</b>');
    expect(await page.locator('main b').count()).toBe(0);
    expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});
