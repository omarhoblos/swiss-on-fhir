import type { Page, Route } from '@playwright/test';
import { expect, test, AUTH_ISSUER, FHIR_BASE, RUNTIME_CONFIG } from './fixtures';

/** A session as the callback would have stored it, so no login is needed. */
async function seedSession(page: Page) {
  const obtainedAt = Date.now();
  const session = {
    tokens: {
      access_token: 'access-1',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-1',
      scope: RUNTIME_CONFIG.scopes
    },
    context: {
      patient: { source: 'none' },
      encounter: { source: 'none' },
      fhirUser: { source: 'none' },
      extras: {}
    },
    obtainedAt,
    expiresAt: obtainedAt + 3600 * 1000,
    requestedScopes: RUNTIME_CONFIG.scopes,
    intent: { flavor: 'standalone' },
    configSnapshot: {
      fhirBaseUrl: FHIR_BASE,
      authIssuer: AUTH_ISSUER,
      clientId: RUNTIME_CONFIG.clientId,
      hasClientSecret: false,
      scopes: RUNTIME_CONFIG.scopes,
      skipIssuerCheck: false,
      clientAuthMethod: 'none',
      audMode: 'exact',
      scopeSyntax: 'auto',
      tokenStorage: 'session',
      redactSecrets: true
    },
    tokenEndpoint: `${AUTH_ISSUER}/token`,
    revocationEndpoint: `${AUTH_ISSUER}/revoke`
  };
  await page.addInitScript((value) => {
    sessionStorage.setItem('swiss.session.v1', value);
  }, JSON.stringify(session));
}

/**
 * Holds requests to `url` until released, so the in-flight state can be
 * asserted without racing a response that arrives in a millisecond.
 */
async function holdRequests(page: Page, url: string, body: object) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(url, async (route: Route) => {
    await released;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
  return release;
}

const spinner = (page: Page) =>
  page.locator('header').getByRole('status').filter({ hasText: 'Updating the session' });

test.describe('session', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test('renders the end-session note as code, not literal backticks', async ({ page }) => {
    // The seeded session has no end_session_endpoint, so the note explains why.
    await page.goto('/');
    const note = page.getByText(/does not advertise end_session_endpoint/);
    await expect(note).toBeVisible();
    await expect(note.locator('code', { hasText: 'end_session_endpoint' })).toBeVisible();
    await expect(note).not.toContainText('`');
  });

  test('spins next to the title while a refresh is in flight', async ({ page }) => {
    const release = await holdRequests(page, `${AUTH_ISSUER}/token`, {
      access_token: 'access-2',
      token_type: 'Bearer',
      expires_in: 3600
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Session', exact: true })).toBeVisible();
    await expect(spinner(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(spinner(page)).toBeVisible();

    release();
    await expect(page.getByText(/^Refreshed\./)).toBeVisible();
    await expect(spinner(page)).toHaveCount(0);
  });

  test('keeps the spinner up briefly after a fast refresh', async ({ page }) => {
    // Answered at once: without a minimum time the spinner would only flicker.
    await page.route(`${AUTH_ISSUER}/token`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: 'access-2', token_type: 'Bearer', expires_in: 3600 })
      })
    );

    await page.goto('/');
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(page.getByText(/^Refreshed\./)).toBeVisible();

    // The request is done, so the button is usable again, but the spinner stays.
    await expect(page.getByRole('button', { name: 'Refresh now' })).toBeEnabled();
    await expect(spinner(page)).toBeVisible();
    await expect(spinner(page)).toHaveCount(0);
  });

  test('spins next to the title while a revoke is in flight', async ({ page }) => {
    const release = await holdRequests(page, `${AUTH_ISSUER}/revoke`, {});

    await page.goto('/');
    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(spinner(page)).toBeVisible();

    release();
    await expect(page.getByText(/^Revocation requested\./)).toBeVisible();
    await expect(spinner(page)).toHaveCount(0);
  });
});
