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
import { expect, seedSession, test } from './fixtures';

const CUSTOM = 'This custom claim comes from your server & is not pre-defined in the spec.';

/** Unsigned, which is fine: the panel decodes for display and never verifies here. */
function jwt(claims: Record<string, unknown>): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256', kid: 'k1' })}.${part(claims)}.c2ln`;
}

async function openIdTokenPanel(page: Page) {
  await seedSession(page, {
    tokens: {
      access_token: 'access-1',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-1',
      scope: 'openid fhirUser',
      id_token: jwt({
        iss: 'https://idp.test',
        sub: 'user-1',
        aud: 'e2e-client',
        exp: 2000000000,
        iat: 1900000000,
        email: 'wonka@example.org',
        azp: 'e2e-client',
        realm_access: { roles: ['clinician'] }
      })
    }
  });
  await page.goto('/');
  const panel = page.locator('details').filter({
    has: page.locator('summary').getByText('ID token', { exact: true })
  });
  await panel.locator('summary').click();
  return panel;
}

test.describe('claims glossary', () => {
  test('explains a claim on hover and in a card', async ({ page }) => {
    const panel = await openIdTokenPanel(page);
    const sub = panel.getByRole('button', { name: 'sub', exact: true });
    await expect(sub).toHaveAttribute('title', /stable identifier for the user/);

    await sub.click();
    const dialog = page.getByRole('dialog', { name: 'sub' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/stable identifier for the user/).first()).toBeVisible();
    const source = dialog.getByRole('link', { name: 'OpenID Connect Core 1.0, §2' });
    await expect(source).toHaveAttribute(
      'href',
      'https://openid.net/specs/openid-connect-core-1_0.html#IDToken'
    );
    await expect(source).toHaveAttribute('rel', 'noopener noreferrer');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('says so, in the agreed words, for a claim no spec defines', async ({ page }) => {
    const panel = await openIdTokenPanel(page);
    const custom = panel.getByRole('button', { name: 'realm_access', exact: true });
    await expect(custom).toHaveAttribute('title', CUSTOM);

    await custom.click();
    const dialog = page.getByRole('dialog', { name: 'realm_access' });
    await expect(dialog.getByText(CUSTOM, { exact: true })).toBeVisible();
  });

  test('opens the full glossary with a search box that filters it', async ({ page }) => {
    await openIdTokenPanel(page);
    await page.getByRole('button', { name: 'Claims glossary' }).click();

    const dialog = page.getByRole('dialog', { name: 'Claims glossary' });
    const search = dialog.getByRole('searchbox', { name: 'Search claims' });
    await expect(search).toBeFocused();
    const names = dialog.locator('li button');
    expect(await names.count()).toBeGreaterThan(30);

    await search.fill('email');
    await expect(names).toHaveText(['email', 'email_verified']);

    // Matched on the meaning ("expiry"), not the name.
    await search.fill('expir');
    await expect(names.filter({ hasText: /^exp$/ })).toHaveCount(1);

    await search.fill('zzqxv');
    await expect(names).toHaveCount(0);
    await expect(dialog.getByText(/No pre-defined claims match/)).toBeVisible();

    // Picking an entry shows its definition in the same card.
    await search.fill('azp');
    await names.filter({ hasText: /^azp$/ }).click();
    await expect(page.getByRole('dialog', { name: 'azp' })).toBeVisible();

    // Reopening starts from the full list again.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Claims glossary' }).click();
    await expect(dialog.getByRole('searchbox', { name: 'Search claims' })).toHaveValue('');
  });
});
