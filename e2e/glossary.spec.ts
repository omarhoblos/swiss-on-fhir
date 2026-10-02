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
  return `${part({ alg: 'RS256', kid: 'k1', typ: 'JWT', 'x-vendor': 'acme' })}.${part(claims)}.c2ln`;
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

test.describe('glossary', () => {
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

  test('explains header parameters the same way, apart from claims', async ({ page }) => {
    const panel = await openIdTokenPanel(page);
    const header = panel.locator('dl').first();
    const kid = header.getByRole('button', { name: 'kid', exact: true });
    await expect(kid).toHaveAttribute('title', /^Key ID/);
    await expect(header.getByRole('button', { name: 'x-vendor', exact: true })).toHaveAttribute(
      'title',
      CUSTOM
    );

    await kid.click();
    const dialog = page.getByRole('dialog', { name: 'kid' });
    await expect(dialog.getByText('Header parameter', { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('link', { name: 'JSON Web Signature (RFC 7515), §4.1.4' })
    ).toHaveAttribute('href', 'https://www.rfc-editor.org/rfc/rfc7515#section-4.1.4');
  });

  test('opens the full glossary with a search box that filters it', async ({ page }) => {
    await openIdTokenPanel(page);
    await page.getByRole('button', { name: 'Glossary', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Glossary', exact: true });
    const search = dialog.getByRole('searchbox', { name: 'Search claims' });
    await expect(search).toBeFocused();
    const names = dialog.locator('li button');
    expect(await names.count()).toBeGreaterThan(60);
    // Header parameters first, then claims, as a token panel lists them.
    await expect(dialog.getByRole('heading', { level: 3 })).toHaveText([
      'Header parameters',
      'Claims'
    ]);

    // Header parameters are searchable too, on their meaning.
    await search.fill('thumbprint');
    await expect(names).toHaveText(['x5t', 'x5t#S256']);
    await expect(dialog.getByRole('heading', { name: 'Claims', exact: true })).toHaveCount(0);

    await search.fill('email');
    await expect(names).toHaveText(['email', 'email_verified']);

    // Matched on the meaning ("expiry"), not the name.
    await search.fill('expir');
    await expect(names.filter({ hasText: /^exp$/ })).toHaveCount(1);

    await search.fill('zzqxv');
    await expect(names).toHaveCount(0);
    await expect(
      dialog.getByText(/No pre-defined claims or header parameters match/)
    ).toBeVisible();

    // Picking an entry shows its definition in the same card.
    await search.fill('azp');
    await names.filter({ hasText: /^azp$/ }).click();
    await expect(page.getByRole('dialog', { name: 'azp' })).toBeVisible();

    // Reopening starts from the full list again.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Glossary', exact: true }).click();
    await expect(dialog.getByRole('searchbox', { name: 'Search claims' })).toHaveValue('');
  });

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 700 },
    { name: 'phone', width: 402, height: 700 }
  ]) {
    test(`keeps the title, definition and search box in view while the list scrolls (${viewport.name})`, async ({
      page
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openIdTokenPanel(page);
      await page.getByRole('button', { name: 'Glossary', exact: true }).click();

      const dialog = page.getByRole('dialog');
      const list = dialog.locator('[data-glossary-list]');
      const search = dialog.getByRole('searchbox', { name: 'Search claims' });
      const heading = dialog.getByRole('heading', { level: 2 });

      // Only the list scrolls; the dialog around it does not.
      expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);

      await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await expect(search).toBeInViewport();
      await expect(heading).toBeInViewport();

      // Picking an entry from the bottom shows its definition without losing the place.
      const last = list.locator('li button').last();
      const name = (await last.textContent())!.trim();
      await last.click();
      await expect(heading).toHaveText(name);
      await expect(heading).toBeInViewport();
      await expect(search).toBeInViewport();
      expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await expect(last).toBeInViewport();

      // A new search starts at the top of what it found.
      await search.fill('e');
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
    });
  }
});
