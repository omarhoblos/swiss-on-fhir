import { expect, test, AUTH_ISSUER, stubDiscovery } from './fixtures';

test.describe('diagnostics', () => {
  test('runs checks and reports a healthy configuration', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');

    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText('FHIR server is reachable', { exact: true })).toBeVisible();
    await expect(page.getByText('SMART configuration document', { exact: true })).toBeVisible();
    await expect(
      page.getByText('OpenID configuration and issuer match', { exact: true })
    ).toBeVisible();

    // The token probe reads the error code: invalid_grant means the client
    // was recognised, which is otherwise unobtainable from a browser.
    await expect(
      page.getByText(/reachable, CORS-enabled, and recognised the client/)
    ).toBeVisible();

    // Unverifiable checks are named rather than omitted.
    await expect(page.getByText(/\d+ manual/)).toBeVisible();
    await expect(page.getByText('Redirect URI is registered', { exact: true })).toBeVisible();
  });

  test('fails an issuer mismatch and offers both fixes', async ({ page }) => {
    await stubDiscovery(page);
    // OIDC Discovery 4.3 requires a byte-identical issuer; this is the
    // mismatch that skipIssuerCheck exists to paper over.
    await page.route(`${AUTH_ISSUER}/.well-known/openid-configuration`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          issuer: 'https://different-idp.test',
          authorization_endpoint: `${AUTH_ISSUER}/authorize`,
          token_endpoint: `${AUTH_ISSUER}/token`
        })
      })
    );

    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/does not match the configured authorization server/)).toBeVisible({
      timeout: 30_000
    });

    // Compliant fix first, escape hatch second.
    await expect(
      page.getByRole('button', { name: /Use "https:\/\/different-idp.test"/ })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Disable the issuer check/ })).toBeVisible();
  });

  test('skips a dependent check by name when its dependency fails', async ({ page }) => {
    await stubDiscovery(page);
    await page.route('**/fhir.test/metadata**', (route) => route.abort('failed'));

    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/Could not reach the FHIR server/)).toBeVisible({
      timeout: 30_000
    });
    await expect(page.getByText(/Skipped because "FHIR server is reachable" failed/)).toBeVisible();
  });
});
