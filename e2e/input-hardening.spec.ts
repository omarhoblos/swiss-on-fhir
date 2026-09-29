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

import { expect, test, seedSession, stubDiscovery } from './fixtures';

/**
 * What comes back from storage, and what a server puts in a token, is input.
 * None of it may take the app down.
 */
test.describe('stored and server-supplied state', () => {
  test('drops a stored session that is not a session', async ({ page }) => {
    await stubDiscovery(page);
    await page.addInitScript(() => {
      // Only on the first load, so the assertion below sees what the app did.
      if (sessionStorage.getItem('swiss.test.seeded')) return;
      sessionStorage.setItem('swiss.test.seeded', '1');
      sessionStorage.setItem('swiss.session.v1', '{"tokens":"not-an-object","context":null}');
    });

    await page.goto('/');

    // The app, not the error page, and no session in it.
    await expect(page.getByRole('heading', { name: 'Session', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No active session' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('swiss.session.v1'))).toBeNull();
  });

  test('survives a fhirUser claim that only looks like a URL', async ({ page }) => {
    // `new URL('https://')` throws. The session is persisted, so before the
    // fix this broke the Session page on every reload.
    await stubDiscovery(page);
    await seedSession(page, {
      context: {
        patient: { source: 'none' },
        encounter: { source: 'none' },
        fhirUser: { value: 'https://', source: 'id-token' },
        extras: {}
      }
    });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Session', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No active session' })).toHaveCount(0);
  });

  test('rejects a setting far longer than any setting could be', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/config');

    const field = page.locator('#config-clientId');
    await field.fill('a'.repeat(5000));
    await field.blur();

    await expect(page.getByText(/the limit is 4096/)).toBeVisible();
    await page.reload();
    await expect(page.locator('#config-clientId')).toHaveValue('e2e-client');
  });
});
