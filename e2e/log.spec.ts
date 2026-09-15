import { expect, test, FHIR_BASE, stubDiscovery } from './fixtures';

test.describe('exchange log', () => {
  test('is reachable on every page and records requests', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/');

    const drawer = page.getByRole('complementary', { name: 'Exchange log' });
    // Present everywhere, because the errors that reference it can appear
    // anywhere.
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { expanded: false })).toBeVisible();

    await page.goto('/diagnostics');
    await expect(drawer).toBeVisible();

    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    // Requests were captured, and download controls appeared with them.
    await drawer.getByRole('button', { expanded: false }).click();
    await expect(drawer.getByRole('button', { name: 'Download JSON' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Download Markdown' })).toBeVisible();
    await expect(drawer.getByText(/Newest first, capped at 200 entries/)).toBeVisible();
  });

  test('survives a reload, which is what makes it useful across the OAuth redirect', async ({
    page
  }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

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

  test('clearing empties the log', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    const drawer = page.getByRole('complementary', { name: 'Exchange log' });
    await drawer.getByRole('button', { name: 'Clear' }).click();
    await expect(drawer.getByRole('button', { name: 'Download JSON' })).toBeHidden();
  });
});
