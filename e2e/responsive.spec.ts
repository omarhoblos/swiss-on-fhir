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
import { expect, seedSession, stubDiscovery, test } from './fixtures';

/**
 * An iPhone 17 is 402 CSS px wide. The header used to need about 600px in
 * one row, so every page scrolled sideways into empty space on a phone.
 */
const PHONE = { width: 402, height: 874 };

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

test.describe('on a phone', () => {
  test.use({ viewport: PHONE });

  test('no page scrolls sideways', async ({ page }) => {
    await stubDiscovery(page);
    await seedSession(page);
    for (const path of ['/', '/config', '/diagnostics', '/launch', '/fhir']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      expect(await horizontalOverflow(page), path).toBe(0);
    }
  });

  test('puts the pages behind a menu that closes on navigation and Escape', async ({ page }) => {
    await page.goto('/config');
    const nav = page.getByRole('navigation', { name: 'Main' });
    const toggle = nav.getByRole('button', { name: 'Open menu' });

    // The inline links are gone; the menu button stands in for them.
    await expect(nav.getByRole('link', { name: 'Diagnostics', exact: true })).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    const close = nav.getByRole('button', { name: 'Close menu' });
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    const menu = page.locator('#main-menu');
    for (const label of ['Config', 'Diagnostics', 'Launch', 'Session', 'FHIR API']) {
      await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(menu.getByRole('link', { name: 'Config', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    );
    // Still dimmed rather than hidden without a session.
    await expect(menu.getByRole('link', { name: 'FHIR API', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(await horizontalOverflow(page)).toBe(0);

    await menu.getByRole('link', { name: 'Diagnostics', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();
    await expect(menu).toHaveCount(0);

    await nav.getByRole('button', { name: 'Open menu' }).click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });
});

test.describe('the exchange log on a phone', () => {
  test.use({ viewport: PHONE });

  test('stays one line, with its actions inside the opened drawer', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();

    const drawer = page.getByRole('complementary', { name: 'Exchange log' });
    const toggle = drawer.getByRole('button', { expanded: false });
    // The bar used to wrap its three buttons onto extra rows pinned over the page.
    const height = await toggle.evaluate((el) => el.parentElement!.getBoundingClientRect().height);
    expect(height).toBeLessThan(44);
    await expect(drawer.getByRole('button', { name: 'Download JSON' })).toBeHidden();

    await toggle.click();
    for (const name of ['Download JSON', 'Download Markdown', 'Clear']) {
      await expect(drawer.getByRole('button', { name, exact: true })).toBeVisible();
    }
    expect(await horizontalOverflow(page)).toBe(0);

    await drawer.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(drawer.getByText('No requests yet.', { exact: false })).toBeVisible();
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('shows the links inline and no menu button', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Diagnostics', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Open menu' })).toBeHidden();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
