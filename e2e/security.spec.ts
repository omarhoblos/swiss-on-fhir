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
  AUTH_ISSUER,
  expect,
  FHIR_BASE,
  RUNTIME_CONFIG,
  seedSession,
  SMART_CONFIGURATION,
  stubDiscovery,
  stubRuntimeConfig,
  test
} from './fixtures';

/**
 * What an outside scanner cannot see: where Swiss keeps credentials, and
 * whether text from a server or a file can become markup or a navigation.
 * The container's headers are checked by the OWASP ZAP scan
 * (npm run security:baseline); these run with every e2e suite.
 */

const SECRETS = ['access-1', 'refresh-1', 'the-client-secret'];

async function everythingStored(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const local = JSON.stringify({ ...localStorage });
    const log = await new Promise<string>((resolve) => {
      const open = indexedDB.open('swiss-log');
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('entries')) return resolve('');
        const all = db.transaction('entries').objectStore('entries').getAll();
        all.onsuccess = () => resolve(JSON.stringify(all.result));
        all.onerror = () => resolve('');
      };
      open.onerror = () => resolve('');
    });
    return local + log;
  });
}

test.describe('credentials', () => {
  test('never travel in a URL, and stay out of localStorage and the stored log', async ({
    page
  }) => {
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/Patient**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'Bundle', total: 0 })
      })
    );
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    page.on('framenavigated', (frame) => urls.push(frame.url()));
    await seedSession(page);

    // A client secret typed in, not remembered.
    await page.goto('/config');
    await page.locator('#config-clientSecret').fill('the-client-secret');
    await page.locator('#config-clientSecret').blur();

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    // Past the log's write delay.
    await page.waitForTimeout(800);

    for (const url of urls) {
      for (const secret of SECRETS) expect(url, url).not.toContain(secret);
    }
    const stored = await everythingStored(page);
    for (const secret of SECRETS) expect(stored).not.toContain(secret);
  });

  test("a tab never sees another tab's session-storage session", async ({ page, context }) => {
    await stubDiscovery(page);
    await seedSession(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Access token lifetime' })).toBeVisible();

    const other = await context.newPage();
    await stubRuntimeConfig(other, RUNTIME_CONFIG);
    await stubDiscovery(other);
    await other.goto('/');
    await expect(other.getByRole('heading', { name: 'No active session' })).toBeVisible();
  });
});

test.describe('text from servers and files', () => {
  test('a javascript: URL in a discovery document never becomes a link', async ({ page }) => {
    await stubDiscovery(page);
    const hostile = {
      ...SMART_CONFIGURATION,
      authorization_endpoint: 'javascript:window.__pwned=1',
      end_session_endpoint: 'javascript:window.__pwned=1',
      management_endpoint: 'javascript:window.__pwned=1'
    };
    for (const url of [
      `${FHIR_BASE}/.well-known/smart-configuration`,
      `${AUTH_ISSUER}/.well-known/openid-configuration`
    ]) {
      await page.route(url, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(hostile)
        })
      );
    }
    await seedSession(page, { endSessionEndpoint: 'javascript:window.__pwned=1' });

    for (const path of ['/launch', '/diagnostics', '/']) {
      await page.goto(path);
      if (path === '/diagnostics') {
        await page.getByRole('button', { name: 'Run checks' }).click();
        await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();
      }
      await page.waitForTimeout(300);
      expect(await page.locator('a[href^="javascript:" i]').count(), path).toBe(0);
    }
    await page.goto('/launch');
    const start = page.getByRole('button', { name: 'Start launch' });
    if (await start.isEnabled()) await start.click();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('a hostile environments file cannot inject markup, ids or endless names', async ({
    page
  }) => {
    await page.goto('/config');
    const markup = '<img src=x onerror="window.__pwned=1">';
    await page.locator('#environments-import').fill(
      JSON.stringify({
        swissEnvironmentsVersion: 1,
        environments: [
          { id: '../../etc', name: markup, settings: { clientId: markup } },
          { name: 'x'.repeat(5000) },
          // A control character, which no setting may hold.
          { name: 'Refused', settings: { clientId: 'bell\u0007' } }
        ]
      })
    );
    await page.getByRole('button', { name: 'Preview' }).click();
    const preview = page.getByTestId('import-preview');
    await expect(preview.getByText(markup).first()).toBeVisible();
    await page.getByRole('button', { name: /^Import \d+ environments?$/ }).click();

    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
    const ids = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('swiss.envs.v1') ?? '[]')
    );
    for (const entry of ids as { id: string; name: string }[]) {
      expect(entry.id).toMatch(/^env-[a-z0-9]{10}$/);
      expect([...entry.name].length).toBeLessThanOrEqual(80);
    }
    // The third entry's client ID held a control character, so it was refused whole.
    expect(ids).toHaveLength(2);
    expect((ids as { name: string }[]).some((e) => e.name === 'Refused')).toBe(false);
  });
});
