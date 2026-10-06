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
import { expect, test } from './fixtures';

const CODE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a'
];

async function typeCode(page: Page) {
  for (const key of CODE) await page.keyboard.press(key);
}

const fireworks = (page: Page) => page.getByTestId('fireworks');

test.describe('Konami Code', () => {
  test('sets off fireworks that clear themselves', async ({ page }) => {
    await page.goto('/config');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(fireworks(page)).toHaveCount(0);

    await typeCode(page);
    await expect(fireworks(page)).toBeVisible();
    // Drawn over the page without getting in its way.
    await expect(fireworks(page)).toHaveCSS('pointer-events', 'none');
    await expect(fireworks(page)).toHaveAttribute('aria-hidden', 'true');
    await page
      .getByRole('button', { name: 'Open menu' })
      .or(page.getByRole('link', { name: 'Diagnostics', exact: true }))
      .first()
      .click();
    await expect(page).toHaveURL(/\/(config|diagnostics)$/);

    await expect(fireworks(page)).toHaveCount(0, { timeout: 8000 });

    // And again.
    await typeCode(page);
    await expect(fireworks(page)).toBeVisible();
  });

  test('ignores keys typed into a field', async ({ page }) => {
    await page.goto('/fhir');
    await page.getByLabel('FHIR query').focus();
    await typeCode(page);
    await expect(fireworks(page)).toHaveCount(0);
  });

  test('sets off nothing for reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/config');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await typeCode(page);
    await page.waitForTimeout(300);
    await expect(fireworks(page)).toHaveCount(0);
  });
});
