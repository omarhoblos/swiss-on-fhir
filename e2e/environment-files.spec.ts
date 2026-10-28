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

import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { exportJWK, generateKeyPair, importJWK, jwtVerify } from 'jose';
import { AUTH_ISSUER, expect, FHIR_BASE, stubDiscovery, test } from './fixtures';

const picker = (page: Page) => page.getByTestId('environment-picker');

/** The export, as a parsed object, through the Download button. */
async function downloadExport(page: Page): Promise<{
  swissEnvironmentsVersion: number;
  environments: {
    name: string;
    settings: Record<string, unknown>;
    publicJwks?: { keys: Record<string, unknown>[] };
  }[];
}> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download JSON' }).click()
  ]);
  return JSON.parse(await readFile((await file.path()) as string, 'utf8'));
}

async function importText(page: Page, text: string) {
  await page.locator('#environments-import').fill(text);
  await page.getByRole('button', { name: 'Preview' }).click();
}

async function pick(page: Page, name: string) {
  await picker(page).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^✓?\\s*${name}`) }).click();
  await expect(picker(page)).toContainText(name);
}

test.describe('exporting', () => {
  test('writes every environment as an array, even when there is only Default', async ({
    page
  }) => {
    await page.goto('/config');
    const exported = await downloadExport(page);
    expect(exported.swissEnvironmentsVersion).toBe(1);
    expect(Array.isArray(exported.environments)).toBe(true);
    expect(exported.environments.map((e) => e.name)).toEqual(['Default']);
    expect(exported).not.toHaveProperty('swissConfigVersion');
  });

  test('round-trips through a browser with nothing in it', async ({ page }) => {
    await page.goto('/config');
    await page.getByRole('button', { name: 'New environment' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Staging');
    await page.getByRole('button', { name: 'Create and switch' }).click();
    await page.locator('#config-fhirBaseUrl').fill('https://fhir.staging.test');
    await page.locator('#config-fhirBaseUrl').blur();
    const exported = await downloadExport(page);
    expect(exported.environments.map((e) => e.name)).toEqual(['Default', 'Staging']);

    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await expect(picker(page)).toContainText('Default');

    await importText(page, JSON.stringify(exported));
    const preview = page.getByTestId('import-preview');
    await expect(preview.getByText('will be named “Default (2)”')).toBeVisible();
    await page.getByRole('button', { name: 'Import 2 environments' }).click();
    await expect(page.getByText(/Imported “Default \(2\)”, “Staging”/)).toBeVisible();

    await pick(page, 'Staging');
    await expect(page.locator('#config-fhirBaseUrl')).toHaveValue('https://fhir.staging.test');
  });
});

test.describe('importing', () => {
  test('brings in a Backend Services key that then signs a token request', async ({ page }) => {
    await stubDiscovery(page);
    const pair = await generateKeyPair('ES384', { extractable: true });
    const privateJwk = { ...(await exportJWK(pair.privateKey)), kid: 'team-key' };
    const publicJwk = await exportJWK(pair.publicKey);
    let verified = false;
    await page.route(`${AUTH_ISSUER}/token`, async (route) => {
      const body = new URLSearchParams(route.request().postData() ?? '');
      if (body.get('grant_type') !== 'client_credentials') return route.fallback();
      const { payload, protectedHeader } = await jwtVerify(
        body.get('client_assertion') ?? '',
        await importJWK(publicJwk, 'ES384')
      );
      verified = payload.iss === 'keyed-backend' && protectedHeader.kid === 'team-key';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'from-imported-key',
          token_type: 'Bearer',
          expires_in: 60
        })
      });
    });

    await page.goto('/config');
    await importText(
      page,
      JSON.stringify({
        swissEnvironmentsVersion: 1,
        environments: [
          {
            name: 'Keyed',
            settings: {
              fhirBaseUrl: FHIR_BASE,
              authIssuer: AUTH_ISSUER,
              clientId: 'keyed-user',
              backendClientId: 'keyed-backend',
              defaultLaunchType: 'backend-services'
            },
            backendServicesKey: privateJwk
          }
        ]
      })
    );
    await expect(page.getByText('carries a Backend Services key')).toBeVisible();
    await page.getByRole('button', { name: 'Import 1 environment' }).click();
    await expect(page.getByText(/Imported “Keyed” with its key/)).toBeVisible();

    await pick(page, 'Keyed');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Launch' })
      .click();
    await expect(page.getByLabel(/Backend services/)).toBeChecked();
    await expect(page.getByText('team-key', { exact: true })).toBeVisible();
    await expect(page.getByText('imported', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Request access token' }).click();
    await expect(page.getByText(/Access token obtained/)).toBeVisible();
    expect(verified).toBe(true);

    // The export shows the public key for reference, and nothing private.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Config' })
      .click();
    const exported = await downloadExport(page);
    const keyed = exported.environments.find((e) => e.name === 'Keyed');
    expect(keyed?.publicJwks?.keys[0]).toMatchObject({ kid: 'team-key', crv: 'P-384' });
    expect(JSON.stringify(exported)).not.toContain(String(privateJwk.d));
  });

  test('imports each environment whole or not at all', async ({ page }) => {
    await page.goto('/config');
    await importText(
      page,
      JSON.stringify({
        swissEnvironmentsVersion: 1,
        environments: [
          { name: 'Broken', settings: { fhirBaseUrl: 'ftp://not-http', clientId: 'x' } },
          { name: 'Fine', settings: { clientId: 'fine' } }
        ]
      })
    );
    const preview = page.getByTestId('import-preview');
    await expect(preview.getByRole('checkbox').first()).toBeDisabled();
    await page.getByRole('button', { name: 'Import 1 environment' }).click();
    await picker(page).click();
    await expect(page.getByRole('menuitemradio', { name: /Fine/ })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: /Broken/ })).toHaveCount(0);
  });

  test('applies a Swiss 3.1 export to the environment in use, unknown keys and all', async ({
    page
  }) => {
    // Before 3.2 a file whose only problem was an unknown key was applied
    // and then reported as "Nothing was imported".
    await page.goto('/config');
    await importText(
      page,
      JSON.stringify({ swissConfigVersion: 1, clientId: 'from-3-1', retiredThing: true })
    );
    await expect(page.getByText(/retiredThing/)).toBeVisible();
    await page.getByRole('button', { name: 'Apply to Default' }).click();
    await expect(page.getByText('Applied 1 setting(s) to “Default”.')).toBeVisible();
    await expect(page.locator('#config-clientId')).toHaveValue('from-3-1');
  });

  test('says why a file cannot be imported', async ({ page }) => {
    await page.goto('/config');
    await importText(page, '{"swissEnvironmentsVersion": 9, "environments": []}');
    await expect(page.getByText(/written by a newer Swiss/)).toBeVisible();
  });
});

test.describe('a pasted Backend Services key', () => {
  test('is imported as a PEM, and a key on the wrong curve is refused with a reason', async ({
    page
  }) => {
    await stubDiscovery(page);
    const pem = async (curve: 'P-384' | 'P-256') => {
      const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, [
        'sign',
        'verify'
      ])) as CryptoKeyPair;
      const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
      return `-----BEGIN PRIVATE KEY-----\n${der.toString('base64')}\n-----END PRIVATE KEY-----`;
    };

    await page.goto('/launch');
    await page.getByLabel(/Backend services/).check();
    await page.getByRole('button', { name: 'Import a private key' }).click();

    await page.getByLabel('Private key', { exact: true }).fill(await pem('P-256'));
    await page.getByRole('button', { name: 'Import key' }).click();
    await expect(page.getByText(/P-256/).first()).toBeVisible();
    await expect(page.getByLabel('Private key', { exact: true })).toHaveValue('');

    await page.getByLabel('Private key', { exact: true }).fill(await pem('P-384'));
    await page.getByRole('button', { name: 'Import key' }).click();
    await expect(page.getByText(/Imported a ES384 key/)).toBeVisible();
    await expect(page.getByText('imported', { exact: true })).toBeVisible();
  });
});
