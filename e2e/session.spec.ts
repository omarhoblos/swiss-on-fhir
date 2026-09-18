import type { Page, Route } from '@playwright/test';
import { expect, test, AUTH_ISSUER, FHIR_BASE, RUNTIME_CONFIG } from './fixtures';

/** A session as the callback would have stored it, so no login is needed. */
async function seedSession(page: Page, overrides: Record<string, unknown> = {}) {
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
    revocationEndpoint: `${AUTH_ISSUER}/revoke`,
    ...overrides
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

  test('copies a token from its header without opening the section', async ({
    page,
    context,
    browserName
  }) => {
    test.skip(browserName !== 'chromium', 'Clipboard permissions can only be granted in Chromium');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/');
    const panel = page.locator('details').filter({ hasText: 'Access token' }).first();
    const copy = panel.locator('summary').getByRole('button', { name: 'Copy' });

    await copy.click();
    await expect(panel.locator('summary').getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('access-1');
    // The button sits in the <summary>, so a click must not also toggle it.
    await expect(panel).not.toHaveAttribute('open', '');
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

/** An unsigned JWT: Swiss only decodes the access token, it never verifies it. */
function fakeJwt(claims: object): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`;
}

test.describe('granted scopes', () => {
  test('reads a backend services grant from the access token when the response omits it', async ({
    page
  }) => {
    // The reported case: the response has no `scope`, the JWT does, and the
    // server collapsed two requested scopes into one wildcard.
    await seedSession(page, {
      tokens: {
        access_token: fakeJwt({ sub: 'swiss', scope: 'system/*.*' }),
        token_type: 'Bearer',
        expires_in: 300
      },
      requestedScopes: 'system/*.read system/*.write',
      intent: { flavor: 'backend-services' }
    });

    await page.goto('/');
    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Granted vs requested scopes' }) });

    await expect(card.getByText('Everything you asked for was granted.')).toBeVisible();
    await expect(card.getByText(/Granted by a broader scope \(2\)/)).toBeVisible();
    await expect(card.getByText(/read from the\s+access token/)).toBeVisible();
    await expect(card.getByText(/Not granted/)).toHaveCount(0);
  });

  test('shows the granted scopes expanded', async ({ page }) => {
    await seedSession(page);
    await page.goto('/');
    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Granted vs requested scopes' }) });

    await expect(card.locator('details')).toHaveAttribute('open', '');
    await expect(card.getByText('patient/*.read', { exact: true })).toBeVisible();
  });
});
