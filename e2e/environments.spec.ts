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

import {
  AUTH_ISSUER,
  expect,
  seedSession,
  sessionKey,
  sessionRecord,
  stubDiscovery,
  test
} from './fixtures';

test.describe('upgrading from 3.1', () => {
  test('moves the settings, secret and session into the Default environment', async ({ page }) => {
    await stubDiscovery(page);
    const legacySession = JSON.stringify(sessionRecord());
    await page.addInitScript((session) => {
      // Only on the first load, so the assertions see what the app did.
      if (sessionStorage.getItem('swiss.test.seeded')) return;
      sessionStorage.setItem('swiss.test.seeded', '1');
      localStorage.setItem('swiss.config.overrides.v1', JSON.stringify({ clientId: 'migrated' }));
      sessionStorage.setItem('swiss.config.secret.session.v1', 'old-secret');
      sessionStorage.setItem('swiss.session.v1', session);
    }, legacySession);

    await page.goto('/config');
    const clientRow = page.locator('[data-config-field="clientId"]');
    await expect(clientRow.locator('#config-clientId')).toHaveValue('migrated');
    await expect(clientRow.getByText('edited here', { exact: true })).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Access token lifetime' })).toBeVisible();

    const keys = await page.evaluate(() => ({
      oldOverrides: localStorage.getItem('swiss.config.overrides.v1'),
      oldSecret: sessionStorage.getItem('swiss.config.secret.session.v1'),
      oldSession: sessionStorage.getItem('swiss.session.v1'),
      overrides: localStorage.getItem('swiss.env.v1.default.overrides'),
      secret: sessionStorage.getItem('swiss.config.secret.session.v1.default'),
      session: sessionStorage.getItem('swiss.session.v1.default.standalone')
    }));
    expect(keys.oldOverrides).toBeNull();
    expect(keys.oldSecret).toBeNull();
    expect(keys.oldSession).toBeNull();
    expect(JSON.parse(keys.overrides ?? '{}')).toEqual({ clientId: 'migrated' });
    expect(keys.secret).toBe('old-secret');
    expect(keys.session).toBe(legacySession);
  });

  test('keeps a Backend Services key generated before 3.2', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/');
    // The 3.1 shape: one record, `backend-services`, holding a non-extractable key.
    await page.evaluate(async () => {
      const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, false, [
        'sign',
        'verify'
      ])) as CryptoKeyPair;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('swiss-keys', 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('keypairs', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('keypairs', 'readwrite');
        tx.objectStore('keypairs').put({
          id: 'backend-services',
          alg: 'ES384',
          kid: 'legacy-kid',
          privateKey: pair.privateKey,
          publicKey: pair.publicKey,
          createdAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    await page.goto('/launch');
    await page.getByLabel(/Backend services/).check();
    await expect(page.getByText('legacy-kid', { exact: true })).toBeVisible();

    const ids = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('swiss-keys', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = db.transaction('keypairs').objectStore('keypairs').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return keys;
    });
    expect(ids).toEqual(['default']);
  });
});

test.describe('session storage', () => {
  test('a session kept in local storage survives a reload', async ({ page }) => {
    await stubDiscovery(page);
    await page.addInitScript(
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

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Access token lifetime' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Access token lifetime' })).toBeVisible();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), sessionKey())).toBeNull();
  });

  test('changing the storage setting moves the session', async ({ page }) => {
    await stubDiscovery(page);
    await seedSession(page);
    await page.goto('/config');

    await page.locator('#config-tokenStorage').selectOption('local');

    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, sessionKey()))
      .toBe(true);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), sessionKey())).toBeNull();
  });
});

test.describe('session slots', () => {
  test('a Backend Services token sits beside the standalone session', async ({ page }) => {
    await stubDiscovery(page);
    await seedSession(page);
    // Registered after stubDiscovery, so it answers instead of its token stub.
    await page.route(`${AUTH_ISSUER}/token`, async (route) => {
      const body = new URLSearchParams(route.request().postData() ?? '');
      if (body.get('grant_type') !== 'client_credentials') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'backend-token',
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'system/*.read'
        })
      });
    });

    await page.goto('/launch');
    await page.getByLabel(/Backend services/).check();
    await page.getByRole('button', { name: 'Generate a key pair' }).click();
    await expect(page.getByText('Key ID (kid)')).toBeVisible();
    await page.getByRole('button', { name: 'Request access token' }).click();
    await expect(page.getByText(/Access token obtained/)).toBeVisible();

    await page.goto('/');
    const slots = page.getByRole('group', { name: 'Session shown' });
    // The new token is shown, and the standalone one is still held.
    await expect(slots.getByRole('button', { name: /Backend services/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(slots.getByRole('button', { name: /Standalone \(holds tokens\)/ })).toBeVisible();
    await expect(slots.getByRole('button', { name: /EHR launch \(empty\)/ })).toBeVisible();

    await page.goto('/fhir');
    await expect(page.getByTestId('token-slot')).toContainText('Backend Services');

    await page.goto('/');
    await slots.getByRole('button', { name: /Standalone/ }).click();
    await expect(slots.getByRole('button', { name: /Standalone/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.getByRole('heading', { name: 'Access token lifetime' })).toBeVisible();

    const stored = await page.evaluate(
      ([standalone, backend]) => ({
        standalone: JSON.parse(sessionStorage.getItem(standalone) ?? '{}').tokens?.access_token,
        backend: JSON.parse(sessionStorage.getItem(backend) ?? '{}').tokens?.access_token
      }),
      [sessionKey('default', 'standalone'), sessionKey('default', 'backend-services')] as const
    );
    expect(stored).toEqual({ standalone: 'access-1', backend: 'backend-token' });
  });

  test('discarding one slot keeps the others', async ({ page }) => {
    await stubDiscovery(page);
    await seedSession(page);
    await seedSession(page, { intent: { flavor: 'ehr' } });
    await page.goto('/');

    const slots = page.getByRole('group', { name: 'Session shown' });
    await slots.getByRole('button', { name: /EHR launch/ }).click();
    await page.getByRole('button', { name: 'Discard locally' }).click();

    await expect(page.getByRole('heading', { name: 'No active session' })).toBeVisible();
    await expect(page.getByText('Another launch type holds tokens')).toBeVisible();
    await expect(slots.getByRole('button', { name: /Standalone \(holds tokens\)/ })).toBeVisible();
  });
});
