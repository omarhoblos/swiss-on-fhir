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
import { expect, stubDiscovery, test } from './fixtures';

/**
 * Every dropdown draws Swiss's own chevron rather than the browser's arrow,
 * which Chrome placed almost against the right border. The chevron is a
 * background image, so what can be checked is that the native arrow is off,
 * the chevron is there in the right colour for the theme, and the dropdown
 * leaves room for it.
 */
async function dropdownStyle(page: Page) {
  return page
    .locator('select')
    .first()
    .evaluate((s) => {
      const c = getComputedStyle(s);
      return { appearance: c.appearance, paddingRight: c.paddingRight, image: c.backgroundImage };
    });
}

const pages: [string, (page: Page) => Promise<void>][] = [
  ['the FHIR API method', async (page) => page.goto('/fhir').then(() => undefined)],
  ['a Config option', async (page) => page.goto('/config').then(() => undefined)],
  [
    'the Backend services algorithm',
    async (page) => {
      await page.goto('/launch');
      await page.getByLabel(/Backend services/).check();
    }
  ],
  [
    'a Diagnostics status filter',
    async (page) => {
      await page.goto('/diagnostics');
      await page.getByRole('button', { name: 'Run checks' }).click();
      await page.locator('select').first().waitFor({ timeout: 30_000 });
    }
  ]
];

test.describe('dropdowns', () => {
  for (const [name, open] of pages) {
    test(`${name} draws its own chevron, with room for it`, async ({ page }) => {
      await stubDiscovery(page);
      await open(page);
      const style = await dropdownStyle(page);
      expect(style.appearance).toBe('none');
      expect(style.paddingRight).toBe('28px');
      expect(style.image).toContain('svg');
    });
  }

  test('the chevron follows the theme', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/fhir');
    const before = (await dropdownStyle(page)).image;

    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
    const after = (await dropdownStyle(page)).image;

    expect(after).not.toBe(before);
    expect([before, after].some((i) => i.includes('b3b3b3'))).toBe(true);
    expect([before, after].some((i) => i.includes('52525b'))).toBe(true);
  });

  test('still works as a dropdown', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/fhir');
    const method = page.getByLabel('HTTP method');
    await method.selectOption('POST');
    await expect(method).toHaveValue('POST');
  });
});
