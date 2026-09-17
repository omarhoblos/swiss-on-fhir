import { expect, test } from './fixtures';

/**
 * Redirect-URI compatibility. Existing Swiss client registrations point at
 * three different landing shapes, and all of them must keep working.
 */
test.describe('callback routing', () => {
  test('forwards OAuth parameters from an unknown path to the callback', async ({ page }) => {
    await page.goto('/index.html?code=abc&state=xyz');
    await expect(page).toHaveURL(/\/callback/);
    // No pending transaction in this tab, which is reported precisely.
    await expect(page.getByText(/could not be processed/i)).toBeVisible();
  });

  test('sends an unknown path with no OAuth parameters to the home page', async ({ page }) => {
    // Reproduces Angular's { path: '**', redirectTo: '' }.
    await page.goto('/no-such-page');
    await expect(page).toHaveURL('http://localhost:4173/');
    await expect(page.getByRole('heading', { name: 'Session', exact: true })).toBeVisible();
  });

  test('redirects the legacy /fhirdata route to /fhir', async ({ page }) => {
    await page.goto('/fhirdata');
    await expect(page).toHaveURL(/\/fhir$/);
    await expect(page.getByRole('heading', { name: 'FHIR API' })).toBeVisible();
  });

  test('strips the authorization code from the URL', async ({ page }) => {
    // Codes are single-use, so leaving one in the URL means a reload
    // re-sends it and the server answers invalid_grant.
    await page.goto('/callback?code=abc&state=xyz');
    await expect(page).toHaveURL('http://localhost:4173/callback');
  });

  test('keeps config and diagnostics reachable without a session', async ({ page }) => {
    // The old nav hid these behind authentication, which was backwards:
    // they are exactly what you need before auth works.
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });

    await nav.getByRole('link', { name: 'Config', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();

    await nav.getByRole('link', { name: 'Diagnostics', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();

    // Session-gated links are dimmed but present, so a new user can see the
    // features exist. The Angular nav hid them entirely.
    const fhirLink = nav.getByRole('link', { name: 'FHIR API', exact: true });
    await expect(fhirLink).toBeVisible();
    await expect(fhirLink).toHaveAttribute('aria-disabled', 'true');
  });
});
