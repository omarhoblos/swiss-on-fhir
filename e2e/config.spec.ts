import { expect, test, RUNTIME_CONFIG, stubRuntimeConfig } from './fixtures';

/**
 * The highest-value spec in the suite: it covers the whole configuration
 * system, which is the crux of the rewrite.
 */
test.describe('configuration', () => {
  test('loads .env values, overrides them live, persists, and resets', async ({ page }) => {
    await page.goto('/config');

    const fhirRow = page.locator('[data-config-field="fhirBaseUrl"]');
    const fhirInput = fhirRow.locator('#config-fhirBaseUrl');
    await expect(fhirInput).toHaveValue(RUNTIME_CONFIG.fhirBaseUrl);

    // Sourced from the runtime file, not a built-in default.
    await expect(fhirRow.getByText('from .env', { exact: true })).toBeVisible();

    // Override it live.
    await fhirInput.fill('https://override.test/baseR4');
    await fhirInput.blur();

    await expect(fhirRow.getByText('edited here', { exact: true })).toBeVisible();

    // Survives a reload.
    await page.reload();
    await expect(fhirRow.locator('#config-fhirBaseUrl')).toHaveValue(
      'https://override.test/baseR4'
    );
    await expect(fhirRow.getByText('edited here', { exact: true })).toBeVisible();

    // Per-field reset returns to the .env value, not a built-in default.
    await fhirRow.getByRole('button', { name: /Reset to \.env value/ }).click();
    await expect(fhirRow.locator('#config-fhirBaseUrl')).toHaveValue(RUNTIME_CONFIG.fhirBaseUrl);
    await expect(fhirRow.getByText('from .env', { exact: true })).toBeVisible();
  });

  test('shows the derived redirect URI to register', async ({ page }) => {
    await page.goto('/config');
    await expect(page.getByText('http://localhost:4173/callback').first()).toBeVisible();
  });

  test('reports a broken runtime config without a white screen', async ({ page }) => {
    // The anti-white-screen guarantee: a JS config file with a syntax error
    // was unrecoverable in 2.x, which is why this is JSON now.
    await stubRuntimeConfig(page, '{ "authIssuer": ');
    await page.goto('/config');

    await expect(page.getByText(/could not be loaded/i)).toBeVisible();
    await expect(page.getByText(/not valid JSON/i)).toBeVisible();
    // And the editor is still usable, so the user can fix it here.
    await expect(page.locator('#config-fhirBaseUrl')).toBeVisible();
  });

  test('explains an unsubstituted placeholder as a missing envsubst step', async ({ page }) => {
    // The exact Docker regression from 2.x: the template shipped unrendered.
    await stubRuntimeConfig(page, {
      fhirBaseUrl: '${FHIRENDPOINT_URI}',
      authIssuer: '${ISSUER_URI}',
      clientId: '${CLIENT_ID}',
      clientSecret: '',
      scopes: '${SCOPES}',
      skipIssuerCheck: '${SKIP_ISSUER_CHECK}'
    });
    await page.goto('/config');
    await expect(page.getByText(/envsubst step did not run/i).first()).toBeVisible();
  });

  test('accepts a 2.x .env and reports the removed keys as safe to delete', async ({ page }) => {
    await stubRuntimeConfig(page, {
      ...RUNTIME_CONFIG,
      redirectUri: 'http://localhost:4173/index.html',
      logoutUri: 'https://idp.test/logout',
      requireHttps: 'false',
      strictDiscoveryDocumentValidation: 'true'
    });
    await page.goto('/config');

    // Still loads, with the real values applied.
    await expect(page.locator('#config-fhirBaseUrl')).toHaveValue(RUNTIME_CONFIG.fhirBaseUrl);
    const ignored = page.locator('section', { hasText: 'Ignored settings' });
    await expect(ignored).toBeVisible();
    for (const key of ['redirectUri', 'logoutUri', 'requireHttps']) {
      await expect(ignored.getByText(key, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(/safe to delete/i).first()).toBeVisible();
  });
});
