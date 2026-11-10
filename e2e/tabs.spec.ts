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

import type { BrowserContext, Page } from '@playwright/test';
import {
  AUTH_ISSUER,
  expect,
  RUNTIME_CONFIG,
  seedSession,
  sessionKey,
  sessionRecord,
  stubDiscovery,
  stubRuntimeConfig,
  test
} from './fixtures';

/** A second page in the same browser context: another tab, sharing storage and channels. */
async function secondTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await stubRuntimeConfig(page, RUNTIME_CONFIG);
  await stubDiscovery(page);
  return page;
}

/**
 * Answers refresh requests with rotated tokens, slowly enough for two tabs
 * to overlap, and records which refresh tokens were presented. Routed per
 * page, after stubDiscovery: a page's routes win over the context's.
 */
function rotatingTokenEndpoint(delayMs = 0) {
  const presented: string[] = [];
  const attach = (page: Page) =>
    page.route(`${AUTH_ISSUER}/token`, async (route) => {
      const body = new URLSearchParams(route.request().postData() ?? '');
      if (body.get('grant_type') !== 'refresh_token') return route.fallback();
      const token = body.get('refresh_token') ?? '';
      presented.push(token);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: `access-after-${token}`,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: `${token}-next`
        })
      });
    });
  return { presented, attach };
}

test.describe('browser tab ids', () => {
  test('a duplicated tab gets its own id', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'No active session' })).toBeVisible();
    const original = await page.evaluate(() => sessionStorage.getItem('swiss.tab.v1'));
    expect(original).toMatch(/^[a-z0-9]{8}$/);
    // A tab answers only once its own duplicate check has settled (150ms).
    await page.waitForTimeout(300);

    // A browser's "Duplicate tab" copies sessionStorage, id included.
    const copy = await secondTab(context);
    await copy.addInitScript(
      ([id]) => {
        if (sessionStorage.getItem('swiss.test.seeded')) return;
        sessionStorage.setItem('swiss.test.seeded', '1');
        sessionStorage.setItem('swiss.tab.v1', id);
      },
      [original ?? ''] as const
    );
    await copy.goto('/');

    await expect
      .poll(() => copy.evaluate(() => sessionStorage.getItem('swiss.tab.v1')))
      .not.toBe(original);
    expect(await page.evaluate(() => sessionStorage.getItem('swiss.tab.v1'))).toBe(original);
  });
});

test.describe('the exchange log across tabs', () => {
  test('each tab keeps its own entries, and shows only its own', async ({ page, context }) => {
    await stubDiscovery(page);
    await page.goto('/launch');
    await expect(page.getByText('Launch mode')).toBeVisible();

    const other = await secondTab(context);
    await other.goto('/launch');
    await expect(other.getByText('Launch mode')).toBeVisible();
    // Give both tabs time to save (the log batches its writes).
    await page.waitForTimeout(800);

    const stored = () =>
      page.evaluate(
        () =>
          new Promise<string[]>((resolve) => {
            const open = indexedDB.open('swiss-log');
            open.onsuccess = () => {
              const all = open.result.transaction('entries').objectStore('entries').getAll();
              all.onsuccess = () => resolve(all.result.map((e: { tabId: string }) => e.tabId));
            };
          })
      );
    const mine = await page.evaluate(() => sessionStorage.getItem('swiss.tab.v1'));

    // Before 3.2 the tab that saved last erased the other's log. The Session
    // page sends nothing, so what the drawer shows is what was stored.
    await page.goto('/');
    const tabIds = await stored();
    expect(new Set(tabIds).size).toBe(2);
    await page.getByRole('button', { name: /Exchange log/ }).click();
    const drawer = page.getByRole('complementary', { name: 'Exchange log' });
    await expect(drawer.locator('details').first()).toBeVisible();
    expect(await drawer.locator('details').count()).toBe(tabIds.filter((id) => id === mine).length);
  });
});

test.describe('refreshing in two tabs', () => {
  test('a shared session is refreshed once, and the other tab takes up the result', async ({
    page,
    context
  }) => {
    const { presented, attach } = rotatingTokenEndpoint(600);
    const seed = async (target: Page) => {
      await target.addInitScript(
        ([key, session]) => {
          if (localStorage.getItem('swiss.test.seeded')) return;
          localStorage.setItem('swiss.test.seeded', '1');
          localStorage.setItem(
            'swiss.env.v1.default.overrides',
            JSON.stringify({ tokenStorage: 'local' })
          );
          localStorage.setItem(key, session);
        },
        [sessionKey(), JSON.stringify(sessionRecord())] as const
      );
    };
    await stubDiscovery(page);
    await attach(page);
    await seed(page);
    await page.goto('/');
    const other = await secondTab(context);
    await attach(other);
    await other.goto('/');
    await expect(other.getByRole('heading', { name: 'Access token lifetime' })).toBeVisible();

    await Promise.all([
      page.getByRole('button', { name: 'Refresh now' }).click(),
      other.getByRole('button', { name: 'Refresh now' }).click()
    ]);

    const messages = [
      page.getByText(/^Refreshed\.|Another tab refreshed these tokens first/),
      other.getByText(/^Refreshed\.|Another tab refreshed these tokens first/)
    ];
    for (const message of messages) await expect(message).toBeVisible({ timeout: 10_000 });
    // The token was presented once; the second tab did not send the spent one.
    expect(presented).toEqual(['refresh-1']);
    // Exactly one tab sent it; the other took up its result.
    const tookUp = async (target: Page) =>
      target.getByText('Another tab refreshed these tokens first').count();
    expect((await tookUp(page)) + (await tookUp(other))).toBe(1);
  });

  test('a copy of a rotated refresh token is not sent again unasked', async ({ page, context }) => {
    const { presented, attach } = rotatingTokenEndpoint();
    await stubDiscovery(page);
    await attach(page);
    // Both tabs hold the same tokens in their own session storage, as a
    // duplicated tab does.
    await seedSession(page);
    await page.goto('/');
    const copy = await secondTab(context);
    await attach(copy);
    await seedSession(copy);
    await copy.goto('/');
    await expect(copy.getByRole('heading', { name: 'Access token lifetime' })).toBeVisible();

    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(page.getByText(/^Refreshed\./)).toBeVisible();

    const warning = copy.getByText('This refresh token was already used by another tab');
    await expect(warning).toBeVisible();
    await copy.getByRole('button', { name: 'Refresh now' }).click();
    await expect(copy.getByText(/so nothing was sent/)).toBeVisible();
    expect(presented).toEqual(['refresh-1']);

    // Reloading finds nothing newer: session storage is per tab.
    await copy.getByRole('button', { name: 'Reload tokens from storage' }).click();
    await expect(copy.getByText(/Storage holds no newer tokens/)).toBeVisible();

    await copy.getByRole('button', { name: 'Send anyway (tests reuse detection)' }).click();
    await expect.poll(() => presented).toEqual(['refresh-1', 'refresh-1']);
  });
});
