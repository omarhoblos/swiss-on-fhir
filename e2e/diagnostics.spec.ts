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

  test('fails an issuer mismatch and offers the compliant fix', async ({ page }) => {
    await stubDiscovery(page);
    // OIDC Discovery 4.3 requires a byte-identical issuer. Swiss's own flow
    // does not enforce it, but a conforming client would reject this.
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
    await expect(
      checkRows(page).getByText(/does not match the configured authorization server/)
    ).toBeVisible({
      timeout: 30_000
    });

    await expect(
      page.getByRole('button', { name: /Use "https:\/\/different-idp.test"/ })
    ).toBeVisible();
    // The old escape hatch changed nothing but this check's label.
    await expect(page.getByRole('button', { name: /Disable the issuer check/ })).toHaveCount(0);
  });

  test('spins next to the title until the run finishes', async ({ page }) => {
    await stubDiscovery(page);
    // Held, so the run cannot finish before the spinner is asserted.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route(`${AUTH_ISSUER}/token`, async (route) => {
      await released;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant' })
      });
    });

    await page.goto('/diagnostics');
    const spinner = page
      .locator('header')
      .getByRole('status')
      .filter({ hasText: 'Running checks' });
    await expect(spinner).toHaveCount(0);

    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(spinner).toBeVisible();

    release();
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 30_000 });
    await expect(spinner).toHaveCount(0);
  });

  test('lists checks that need attention under the summary', async ({ page }) => {
    await stubDiscovery(page);
    // A 404 JWKS gives one failure to list.
    await page.route(`${AUTH_ISSUER}/.well-known/jwks.json`, (route) =>
      route.fulfill({ status: 404, body: '' })
    );

    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/\d+ passed/)).toBeVisible({ timeout: 30_000 });

    const summary = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Summary', exact: true }) });
    await expect(summary.getByRole('heading', { name: 'Failed', exact: true })).toBeVisible();

    // Passed checks are not listed; the failing one links to its row.
    await expect(summary.getByRole('button', { name: 'FHIR server is reachable' })).toHaveCount(0);
    await summary.getByRole('button', { name: 'JWKS is fetchable' }).click();
    await expect(page.locator('details[id="check-disc.jwks"]')).toHaveAttribute('open', '');
    await expect(page.locator('details[id="check-disc.jwks"]')).toBeInViewport();
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

  test('passes the JWKS check at the conventional path', async ({ page }) => {
    await stubDiscovery(page);

    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText('1 signing key(s) published.', { exact: true })).toBeVisible();
  });

  test('warns when the jwks_uri is not at /.well-known/jwks.json', async ({ page }) => {
    await stubDiscovery(page);
    await advertiseJwks(page, 'smart-configuration', `${AUTH_ISSUER}/jwk`);
    await serveKeys(page, `${AUTH_ISSUER}/jwk`);

    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    await expect(
      checkRows(page).getByText(
        /1 signing key\(s\) published, but not at .*\/\.well-known\/jwks\.json/
      )
    ).toBeVisible();
  });

  test("falls back to openid-configuration when smart-configuration's jwks_uri is unreachable", async ({
    page
  }) => {
    await stubDiscovery(page);
    await advertiseJwks(page, 'smart-configuration', `${AUTH_ISSUER}/broken/.well-known/jwks.json`);
    await page.route(`${AUTH_ISSUER}/broken/.well-known/jwks.json`, (route) =>
      route.fulfill({ status: 404, body: '' })
    );

    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    await expect(
      checkRows(page).getByText(
        /1 signing key\(s\) published, but smart-configuration's is unreachable\./
      )
    ).toBeVisible();
    await expect(
      checkRows(page).getByText(/The jwks_uri in smart-configuration .* is unreachable/)
    ).toBeVisible();
  });

  test('fails when both jwks_uris are unreachable', async ({ page }) => {
    await stubDiscovery(page);
    await advertiseJwks(page, 'smart-configuration', `${AUTH_ISSUER}/broken/.well-known/jwks.json`);
    await page.route(`${AUTH_ISSUER}/**/jwks.json`, (route) =>
      route.fulfill({ status: 404, body: '' })
    );

    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(page.getByText(/passed/)).toBeVisible({ timeout: 30_000 });

    await expect(
      checkRows(page).getByText(
        /The jwks_uri in both smart-configuration and openid-configuration is unreachable\./
      )
    ).toBeVisible();
  });

  test('skips a dependent check by name when its dependency fails', async ({ page }) => {
    await stubDiscovery(page);
    await page.route('**/fhir.test/metadata**', (route) => route.abort('failed'));

    await page.goto('/diagnostics');
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect(checkRows(page).getByText(/Could not reach the FHIR server/)).toBeVisible({
      timeout: 30_000
    });
    await expect(
      checkRows(page).getByText(/Skipped because "FHIR server is reachable" failed/)
    ).toBeVisible();
  });
});

/** Overrides one discovery document's `jwks_uri`, leaving the rest of the fixture. */
async function advertiseJwks(
  page: Page,
  document: 'smart-configuration' | 'openid-configuration',
  jwksUri: string
) {
  const url =
    document === 'smart-configuration'
      ? `${FHIR_BASE}/.well-known/smart-configuration`
      : `${AUTH_ISSUER}/.well-known/openid-configuration`;
  await page.route(url, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...SMART_CONFIGURATION, jwks_uri: jwksUri })
    })
  );
}

async function serveKeys(page: Page, url: string) {
  await page.route(url, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ keys: [{ kty: 'RSA', alg: 'RS256', kid: 'k1' }] })
    })
  );
}

/**
 * The check rows themselves. A warning, failure or skip also has its summary
 * listed in the Summary card, so text matched page-wide would find it twice.
 */
function checkRows(page: Page) {
  return page.locator('details[id^="check-"]');
}
