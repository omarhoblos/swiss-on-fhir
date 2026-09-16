import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  AUTH_ISSUER,
  FHIR_BASE,
  SMART_CONFIGURATION,
  stubDiscovery
} from './fixtures';

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

  test('filters each group by status independently', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    // Scoped by heading: a <section> only exposes the region role once it has
    // an accessible name, and naming every Card in the app would make
    // landmark navigation useless rather than better.
    const cardFor = (title: string) =>
      page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    const environment = cardFor('Environment');
    const discovery = cardFor('Discovery');

    const envFilter = page.getByLabel('Filter Environment checks by status');
    const discFilter = page.getByLabel('Filter Discovery checks by status');

    // Every group header carries one, and the options are the five outcomes
    // plus a way back to everything.
    await expect(envFilter).toBeVisible();
    await expect(discFilter).toBeVisible();
    await expect(page.getByLabel('Filter Capabilities checks by status')).toBeVisible();
    await expect(page.getByLabel('Filter Cross-origin access checks by status')).toBeVisible();
    expect(await envFilter.locator('option').allTextContents()).toEqual([
      expect.stringContaining('All statuses'),
      expect.stringContaining('Passed'),
      expect.stringContaining('Warnings'),
      expect.stringContaining('Failed'),
      expect.stringContaining('Skipped'),
      expect.stringContaining('Manual')
    ]);

    const envRows = environment.locator('details');
    const discRows = discovery.locator('details');
    const envTotal = await envRows.count();
    const discTotal = await discRows.count();
    expect(envTotal).toBeGreaterThan(1);
    expect(discTotal).toBeGreaterThan(1);

    // Narrowing Environment leaves Discovery alone -- the filters are
    // per-group, not one control driving the whole page.
    // Each option advertises how many rows it would leave, so the result is
    // checkable against a number rather than just "fewer than before".
    const manualLabel = await envFilter.locator('option[value="manual"]').textContent();
    const manualCount = Number(manualLabel?.match(/\((\d+)\)/)?.[1]);
    expect(manualCount).toBeGreaterThan(0);
    expect(manualCount).toBeLessThan(envTotal);

    await envFilter.selectOption('manual');
    await expect(envRows).toHaveCount(manualCount);
    await expect(discRows).toHaveCount(discTotal);

    // A group with no rows in the chosen status still renders its dropdown,
    // so the filter can be undone.
    await discFilter.selectOption('fail');
    await expect(discovery.getByText(/None of the \d+ checks in this group are/)).toBeVisible();
    await expect(discFilter).toBeVisible();
    await discovery.getByRole('button', { name: 'Show all' }).click();
    await expect(discRows).toHaveCount(discTotal);
    await expect(discFilter).toHaveValue('all');

    // Environment is still where we left it.
    await expect(envFilter).toHaveValue('manual');
    await envFilter.selectOption('all');
    await expect(envRows).toHaveCount(envTotal);
  });

  test('keeps a group filter across a re-run', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    const envFilter = page.getByLabel('Filter Environment checks by status');
    await envFilter.selectOption('manual');

    // If you have filtered down to a status and re-run, you are still
    // looking for that status.
    await page.getByRole('button', { name: 'Run again' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });
    await expect(envFilter).toHaveValue('manual');
  });

  test('downloads the report as a markdown file', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download report' }).click();
    const download = await downloading;

    // Timestamped so successive runs do not overwrite each other, and .md
    // because the report is a transcript meant to go into an issue.
    expect(download.suggestedFilename()).toMatch(/^swiss-diagnostics-[\d-]+T[\d-]+\.md$/);

    const path = await download.path();
    const report = await readFile(path, 'utf8');
    expect(report).toContain('# Swiss on FHIR diagnostics');
    expect(report).toContain('FHIR server is reachable');
  });

  test('links each resolved endpoint', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    const endpoints = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Resolved endpoints', exact: true }) });
    const links = endpoints.locator('dd a');

    expect(await links.count()).toBeGreaterThan(0);

    for (const link of await links.all()) {
      const href = await link.getAttribute('href');
      const text = (await link.textContent())?.trim();
      // The link goes where it says it goes.
      expect(href).toBe(text);
      expect(href).toMatch(/^https?:\/\//);
      // Opened away from a page holding live tokens, so no opener handle and
      // no referrer.
      expect(await link.getAttribute('target')).toBe('_blank');
      expect(await link.getAttribute('rel')).toBe('noopener noreferrer');
    }

    await expect(endpoints.getByRole('link', { name: `${AUTH_ISSUER}/authorize` })).toBeVisible();
  });

  test('finds the key set at /jwk when the advertised URL is /jwk.json', async ({ page }) => {
    // Only /jwk is routed, so a pass proves the suffix fallback did the work.
    // Both documents are overridden, or the fixture's openid-configuration
    // would still be advertising the working URL.
    const advertising = (jwksUri: string) => ({ ...SMART_CONFIGURATION, jwks_uri: jwksUri });
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/.well-known/smart-configuration`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(advertising(`${AUTH_ISSUER}/jwk.json`))
      })
    );
    await page.route(`${AUTH_ISSUER}/.well-known/openid-configuration`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(advertising(`${AUTH_ISSUER}/jwk.json`))
      })
    );
    await page.route(`${AUTH_ISSUER}/jwk.json`, (route) =>
      route.fulfill({ status: 404, body: '' })
    );

    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    // Found, but reported as a metadata problem rather than silently passing.
    await expect(page.getByText(/1 signing key\(s\), but not at the advertised URL/)).toBeVisible();
    await expect(page.getByText(/metadata points at the wrong place/)).toBeVisible();
  });

  test('uses a jwks_uri an outranked document advertised', async ({ page }) => {
    /**
     * The real case. smart-configuration outranks openid-configuration, so a
     * deployment advertising a redirecting `/.well-known/jwks.json` there and
     * the working `/jwk` in openid-configuration had the correct value
     * discovered and then discarded by precedence.
     */
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/.well-known/smart-configuration`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...SMART_CONFIGURATION,
          jwks_uri: `${AUTH_ISSUER}/.well-known/jwks.json`
        })
      })
    );
    await page.route(`${AUTH_ISSUER}/.well-known/jwks.json`, (route) =>
      route.fulfill({ status: 404, body: '' })
    );

    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    // The value from the outranked document is not a guess, so the message
    // says the documents disagree rather than blaming the client.
    await expect(page.getByText(/the two documents disagree/)).toBeVisible();
  });

  test('looks under the issuer when no jwks_uri is advertised', async ({ page }) => {
    const withoutJwks = { ...SMART_CONFIGURATION, jwks_uri: undefined };
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/.well-known/smart-configuration`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(withoutJwks)
      })
    );
    await page.route(`${AUTH_ISSUER}/.well-known/openid-configuration`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...withoutJwks, issuer: AUTH_ISSUER })
      })
    );

    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    // /jwk is the first path guessed under the issuer.
    await expect(
      page.getByText(/so Swiss looked under the issuer and found the key set/)
    ).toBeVisible();
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
