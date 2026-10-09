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
import type { Locator } from '@playwright/test';
import { diagnosticsFinished, expect, FHIR_BASE, stubDiscovery, test } from './fixtures';

test.describe('exchange log', () => {
  test('is reachable on every page and records requests', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/');

    const drawer = page.getByRole('complementary', { name: 'Exchange log' });
    // Present everywhere, because the errors that reference it can appear
    // anywhere.
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole('button', { name: /Exchange log/, expanded: false })
    ).toBeVisible();

    await page.goto('/diagnostics');
    await expect(drawer).toBeVisible();

    await page.getByRole('button', { name: 'Run checks' }).click();
    await diagnosticsFinished(page);

    // Requests were captured, and download controls appeared with them.
    await drawer.getByRole('button', { name: /Exchange log/, expanded: false }).click();
    // One Download button, offering both formats.
    const download = drawer.getByRole('button', { name: 'Download', exact: true });
    await expect(download).toBeVisible();
    await download.click();
    const menu = drawer.getByRole('menu', { name: 'Download' });
    await expect(menu.getByRole('menuitem')).toHaveText(['JSON', 'Markdown']);
    await expect(menu.getByRole('menuitem', { name: 'JSON' })).toBeFocused();
    // From the bar at the bottom of the screen it opens upward, in view.
    await expect(menu).toBeInViewport();
    expect((await menu.boundingBox())!.y).toBeLessThan((await download.boundingBox())!.y);
    // Escape closes it and returns to the button.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(download).toBeFocused();
    await expect(drawer.getByText(/Newest first, capped at 200 entries/)).toBeVisible();
  });

  test('survives a reload, which is what makes it useful across the OAuth redirect', async ({
    page
  }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await diagnosticsFinished(page);

    const countBefore = await page.evaluate(() =>
      Number(
        document
          .querySelector('aside[aria-label="Exchange log"]')
          ?.textContent?.match(/Exchange log\s*(\d+)/)?.[1] ?? 0
      )
    );
    expect(countBefore).toBeGreaterThan(0);

    // Past the persist debounce, then a full page load.
    await page.waitForTimeout(1200);
    await page.goto('/fhir');
    await page.waitForTimeout(1200);

    const countAfter = await page.evaluate(() =>
      Number(
        document
          .querySelector('aside[aria-label="Exchange log"]')
          ?.textContent?.match(/Exchange log\s*(\d+)/)?.[1] ?? 0
      )
    );
    expect(countAfter).toBeGreaterThanOrEqual(countBefore);
  });

  test('never writes credentials to disk', async ({ page }) => {
    await stubDiscovery(page);
    // A response carrying a distinctive token, so a leak is unambiguous.
    await page.route(`${FHIR_BASE}/Patient**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ access_token: 'SENTINEL_TOKEN_VALUE', resourceType: 'Bundle' })
      })
    );

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();

    await page.waitForTimeout(1200);

    const onDisk = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const req = indexedDB.open('swiss-log');
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('exchanges')) return resolve('');
            const get = db
              .transaction('exchanges', 'readonly')
              .objectStore('exchanges')
              .get('current');
            get.onsuccess = () => resolve(JSON.stringify(get.result ?? {}));
            get.onerror = () => resolve('');
          };
          req.onerror = () => resolve('');
        })
    );

    // Something was stored, and the token was not part of it.
    expect(onDisk.length).toBeGreaterThan(0);
    expect(onDisk).not.toContain('SENTINEL_TOKEN_VALUE');
  });

  test('still opens after a reload has restored a persisted log', async ({ page }) => {
    /**
     * Regression test. Exchange ids came from a module counter that restarted
     * at 0 on every page load, so the first request after a reload was `x1`
     * again and collided with the `x1` just restored from IndexedDB. The
     * drawer keys its {#each} by id, so Svelte threw `each_key_duplicate`,
     * the panel never rendered, and the drawer looked like a dead button --
     * permanently, since the bad log stayed on disk across reloads.
     *
     * The existing "survives a reload" test missed it because it reloaded and
     * checked the count without making new requests or opening the drawer,
     * which is where the collision and the throw actually happen.
     */
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await diagnosticsFinished(page);

    // Past the persist debounce, so the log really reaches IndexedDB.
    await page.waitForTimeout(1200);
    await page.reload();

    // A second run, whose ids are the ones that used to collide.
    await page.getByRole('button', { name: /Run checks|Run again/ }).click();
    await diagnosticsFinished(page);

    const drawer = page.getByRole('complementary', { name: 'Exchange log' });
    await drawer.getByRole('button', { name: /Exchange log/, expanded: false }).click();

    // The panel renders, with rows in it.
    await expect(
      drawer.getByRole('button', { name: /Exchange log/, expanded: true })
    ).toBeVisible();
    await expect(drawer.getByText(/Newest first, capped at 200 entries/)).toBeVisible();
    expect(await drawer.locator('details').count()).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('links the request URL without toggling the row', async ({ page }) => {
    /**
     * The URL in a request summary sits inside a <summary>, so a naive link
     * there would open the tab AND expand the row. A link is the activation
     * target in preference to the summary, and the click is stopped as well,
     * so the disclosure must stay shut.
     */
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await diagnosticsFinished(page);

    const drawer = page.getByRole('complementary', { name: 'Exchange log' });
    await drawer.getByRole('button', { name: /Exchange log/, expanded: false }).click();

    const row = drawer.locator('details').first();
    const link = row.locator('summary a').first();
    await expect(link).toBeVisible();

    const href = await link.getAttribute('href');
    expect(href).toBe((await link.textContent())?.trim());
    expect(href).toMatch(/^https?:\/\//);
    // Opened away from an origin holding live tokens.
    expect(await link.getAttribute('target')).toBe('_blank');
    expect(await link.getAttribute('rel')).toBe('noopener noreferrer');

    expect(await row.evaluate((node: HTMLDetailsElement) => node.open)).toBe(false);

    // Clicking opens a tab and leaves the row alone.
    const opening = page.context().waitForEvent('page');
    await link.click();
    const opened = await opening;
    await opened.close();

    expect(await row.evaluate((node: HTMLDetailsElement) => node.open)).toBe(false);

    // The rest of the summary still toggles it.
    await row.locator('summary').click({ position: { x: 5, y: 5 } });
    expect(await row.evaluate((node: HTMLDetailsElement) => node.open)).toBe(true);
  });

  test('clearing empties the log', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await diagnosticsFinished(page);

    const drawer = page.getByRole('complementary', { name: 'Exchange log' });
    await drawer.getByRole('button', { name: 'Clear' }).click();
    await expect(drawer.getByRole('button', { name: 'Download', exact: true })).toBeHidden();
  });
  test('searches and filters entries by status, without touching downloads', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await diagnosticsFinished(page);

    const drawer = page.getByRole('complementary', { name: 'Exchange log' });
    await drawer.getByRole('button', { name: /Exchange log/, expanded: false }).click();
    const rows = drawer.locator('details');
    const total = await rows.count();
    const statusOf = (row: Locator) => row.locator('summary > span').first().innerText();

    // One chip per status present, each shown to begin with. The stubbed token
    // endpoint answers the diagnostics probe with 400, so there is always a
    // 200 and a 400 to choose between.
    const chips = drawer.getByRole('group', { name: 'Show:' }).getByRole('button');
    await expect(chips.filter({ hasText: /^200 / })).toHaveAttribute('aria-pressed', 'true');
    const chip400 = chips.filter({ hasText: /^400 / });
    await expect(chip400).toHaveAttribute('aria-pressed', 'true');

    // Hiding 200 leaves no 200 rows, and says how many are left.
    await chips.filter({ hasText: /^200 / }).click();
    await expect(chips.filter({ hasText: /^200 / })).toHaveAttribute('aria-pressed', 'false');
    const remaining = await rows.count();
    expect(remaining).toBeLessThan(total);
    for (let i = 0; i < remaining; i++) {
      expect(await statusOf(rows.nth(i))).not.toBe('200');
    }
    await expect(drawer.getByText(`Showing ${remaining} of ${total}`)).toBeVisible();

    // The search narrows further, on the URL.
    const search = drawer.getByRole('searchbox', { name: 'Search the exchange log' });
    await search.fill('/token');
    await expect(rows).not.toHaveCount(0);
    for (const url of await rows.locator('summary a').allInnerTexts()) {
      expect(url).toContain('/token');
    }

    // Hiding what is left shows an explanation rather than an empty drawer.
    await chip400.click();
    await expect(
      drawer.getByText('No requests match the search or the statuses shown.')
    ).toBeVisible();

    // Filtering is a view: a download still has every entry.
    await drawer.getByRole('button', { name: 'Download', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      drawer.getByRole('menuitem', { name: 'JSON' }).click()
    ]);
    const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
    expect(exported.entryCount).toBe(total);
    expect(exported.entries).toHaveLength(total);

    await drawer.getByRole('button', { name: 'Show all' }).click();
    await expect(rows).toHaveCount(total);
    await expect(search).toHaveValue('');
    await expect(drawer.getByRole('button', { name: 'Show all' })).toHaveCount(0);
  });
});
