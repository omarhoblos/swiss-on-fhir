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

import type { Page, Route } from '@playwright/test';
import { expect, test, FHIR_BASE, seedSession, stubDiscovery } from './fixtures';

const STATUS_URL = `${FHIR_BASE}/bulk/status/job-1`;
const FILE_URL = `${FHIR_BASE}/bulk/files/patient-1.ndjson`;
const STORAGE_URL = 'https://storage.test/exports/observation-1.ndjson';

/** Answers like a server that exposes what a browser needs to read. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, DELETE',
  'access-control-expose-headers': 'Content-Location, X-Progress, Retry-After'
};

function fulfill(route: Route, status: number, headers: Record<string, string> = {}, body = '') {
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: CORS });
  }
  return route.fulfill({ status, headers: { ...CORS, ...headers }, body });
}

const MANIFEST = (requiresAccessToken: boolean) => ({
  transactionTime: '2026-11-17T10:00:00Z',
  request: `${FHIR_BASE}/$export`,
  requiresAccessToken,
  output: [
    { type: 'Patient', url: FILE_URL, count: 2 },
    { type: 'Observation', url: STORAGE_URL, count: 1 }
  ],
  error: []
});

const NDJSON = '{"resourceType":"Patient","id":"a"}\n{"resourceType":"Patient","id":"b"}\n';

async function stopAutoPolling(page: Page) {
  await page.getByLabel(/Poll based on what/).uncheck();
}

test.describe('Bulk export card', () => {
  test('kicks off, reads the status URL from Content-Location and polls to the manifest', async ({
    page
  }) => {
    await stubDiscovery(page);
    await seedSession(page);

    const kickoffs: Record<string, string>[] = [];
    let kickoffUrl = '';
    await page.route(`${FHIR_BASE}/$export**`, (route) => {
      if (route.request().method() === 'GET') {
        kickoffs.push(route.request().headers());
        kickoffUrl = route.request().url();
      }
      return fulfill(route, 202, { 'content-location': STATUS_URL, 'retry-after': '1' });
    });
    let polls = 0;
    const pollHeaders: Record<string, string>[] = [];
    await page.route(STATUS_URL, (route) => {
      if (route.request().method() === 'OPTIONS') return fulfill(route, 204);
      polls += 1;
      pollHeaders.push(route.request().headers());
      return polls === 1
        ? fulfill(route, 202, { 'x-progress': 'Exporting Patient (40%)', 'retry-after': '120' })
        : fulfill(
            route,
            200,
            { 'content-type': 'application/json' },
            JSON.stringify(MANIFEST(true))
          );
    });
    const fileHeaders: Record<string, string>[] = [];
    await page.route(FILE_URL, (route) => {
      if (route.request().method() === 'GET') fileHeaders.push(route.request().headers());
      return fulfill(route, 200, { 'content-type': 'application/fhir+ndjson' }, NDJSON);
    });

    await page.goto('/fhir');
    const card = page.getByTestId('bulk-export');
    await card.getByText('Parameters').click();
    await card.getByPlaceholder('Patient,Observation').fill('Patient, Observation');
    await expect(card.getByTestId('bulk-kickoff-url')).toHaveText(
      `GET ${FHIR_BASE}/$export?_type=Patient,Observation`
    );

    await card.getByRole('button', { name: 'Start export' }).click();

    await expect(card.getByLabel('Status URL')).toHaveValue(STATUS_URL);
    expect(kickoffUrl).toBe(`${FHIR_BASE}/$export?_type=Patient,Observation`);
    expect(kickoffs[0]?.['prefer']).toBe('respond-async');
    expect(kickoffs[0]?.['accept']).toBe('application/fhir+json');
    expect(kickoffs[0]?.['authorization']).toBe('Bearer access-1');

    // The kick-off's Retry-After is raised to the 2s minimum, then the first poll comes on its own.
    await expect(card.getByTestId('bulk-state')).toHaveText('In progress', { timeout: 10_000 });
    await expect(card.getByTestId('bulk-poll')).toContainText('Exporting Patient (40%)');
    expect(pollHeaders[0]?.['accept']).toBe('application/json');
    // The server asked for two minutes; the card waits that long.
    await expect(card.getByTestId('bulk-poll-status')).toContainText(/Next poll in 1[12]\ds/);

    await card.getByRole('button', { name: 'Poll now' }).click();
    await expect(card.getByTestId('bulk-state')).toHaveText('Complete');
    await expect(card.getByTestId('bulk-poll-status')).not.toContainText('Next poll');

    const output = card.getByTestId('bulk-output');
    await expect(output.getByRole('listitem')).toHaveCount(2);
    await output.getByRole('listitem').first().getByRole('button', { name: 'Read file' }).click();
    await expect(output.getByTestId('bulk-file-summary')).toHaveText('2 lines: 2 Patient');
    expect(fileHeaders[0]?.['accept']).toBe('application/fhir+ndjson');
    expect(fileHeaders[0]?.['authorization']).toBe('Bearer access-1');
  });

  test('says why the status URL is missing, and polls one that is pasted', async ({ page }) => {
    await stubDiscovery(page);
    // A 202 whose Content-Location is sent but not exposed.
    await page.route(`${FHIR_BASE}/$export**`, (route) =>
      route.fulfill({
        status: 202,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'content-location': STATUS_URL
        }
      })
    );
    await page.route(STATUS_URL, (route) =>
      fulfill(route, 200, { 'content-type': 'application/json' }, JSON.stringify(MANIFEST(true)))
    );

    await page.goto('/fhir');
    const card = page.getByTestId('bulk-export');
    await card.getByRole('button', { name: 'Start export' }).click();

    await expect(card.getByTestId('bulk-kickoff')).toContainText('Access-Control-Expose-Headers');
    await expect(card.getByLabel('Status URL')).toHaveValue('');

    await card.getByLabel('Status URL').fill(STATUS_URL);
    await card.getByRole('button', { name: 'Poll now' }).click();
    await expect(card.getByTestId('bulk-state')).toHaveText('Complete');
  });

  const OUTCOME = (diagnostics: string) =>
    JSON.stringify({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'processing', diagnostics }]
    });

  const responseCard = (page: Page) =>
    page.locator('section', { has: page.getByRole('heading', { name: 'Response' }) });

  test('shows a refused kick-off and its OperationOutcome in the Response card', async ({
    page
  }) => {
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/$export**`, (route) =>
      fulfill(route, 400, { 'content-type': 'application/fhir+json' }, OUTCOME('Unknown _type Foo'))
    );

    await page.goto('/fhir');
    const card = page.getByTestId('bulk-export');
    await card.getByRole('button', { name: 'Start export' }).click();

    await expect(responseCard(page).getByText('error/processing')).toBeVisible();
    await expect(card.getByTestId('bulk-kickoff')).toHaveCount(0);
    await expect(card.getByText(/Unknown _type Foo/)).toHaveCount(0);
    await expect(card.getByRole('alert')).toHaveCount(0);

    const response = responseCard(page);
    await expect(response.getByText('error/processing')).toBeVisible();
    await expect(response.getByText(/Unknown _type Foo/).first()).toBeVisible();
    await expect(response.getByText(`${FHIR_BASE}/$export`, { exact: true })).toBeVisible();
  });

  test('shows a failed poll in the Response card, and stops polling', async ({ page }) => {
    await stubDiscovery(page);
    await page.route(STATUS_URL, (route) =>
      fulfill(
        route,
        500,
        { 'content-type': 'application/fhir+json' },
        OUTCOME('Export job crashed')
      )
    );

    await page.goto('/fhir');
    const card = page.getByTestId('bulk-export');
    await card.getByLabel('Status URL').fill(STATUS_URL);
    await card.getByRole('button', { name: 'Poll now' }).click();

    await expect(card.getByTestId('bulk-state')).toHaveText('Failed');
    await expect(card.getByText(/Export job crashed/)).toHaveCount(0);
    await expect(card.getByRole('alert')).toHaveCount(0);
    await expect(card.getByTestId('bulk-poll-status')).not.toContainText('Next poll');

    const response = responseCard(page);
    await expect(response.getByText(/Export job crashed/).first()).toBeVisible();
    await expect(response.getByText(STATUS_URL, { exact: true })).toBeVisible();
  });

  test('keeps a 429 while polling in the card: it is pacing, not a failure', async ({ page }) => {
    await stubDiscovery(page);
    await page.route(STATUS_URL, (route) => fulfill(route, 429, { 'retry-after': '30' }));

    await page.goto('/fhir');
    const card = page.getByTestId('bulk-export');
    await card.getByLabel('Status URL').fill(STATUS_URL);
    await card.getByRole('button', { name: 'Poll now' }).click();

    await expect(card.getByTestId('bulk-state')).toHaveText('Polling too often');
    await expect(card.getByTestId('bulk-poll-status')).toContainText(/Next poll in \d+s/);
    await expect(responseCard(page)).toContainText('No request sent yet.');
  });

  test('shows a refused cancellation in the Response card', async ({ page }) => {
    await stubDiscovery(page);
    await page.route(STATUS_URL, (route) =>
      fulfill(route, 404, { 'content-type': 'application/fhir+json' }, OUTCOME('No such job'))
    );

    await page.goto('/fhir');
    const card = page.getByTestId('bulk-export');
    await card.getByLabel('Status URL').fill(STATUS_URL);
    await card.getByRole('button', { name: 'Cancel export' }).click();

    await expect(
      responseCard(page)
        .getByText(/No such job/)
        .first()
    ).toBeVisible();
    await expect(card.getByTestId('bulk-cancel')).toHaveCount(0);
  });

  test('builds a Group export only once a group id is given', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/fhir');
    const card = page.getByTestId('bulk-export');
    await card.getByLabel('Export level').selectOption('group');
    await expect(card.getByRole('button', { name: 'Start export' })).toBeDisabled();
    await card.getByLabel('Group id').fill('cohort-1');
    await expect(card.getByTestId('bulk-kickoff-url')).toHaveText(
      `GET ${FHIR_BASE}/Group/cohort-1/$export`
    );
    await expect(card.getByRole('button', { name: 'Start export' })).toBeEnabled();
  });

  test('sends no token to the files when the manifest says they need none', async ({ page }) => {
    await stubDiscovery(page);
    await seedSession(page);
    await page.route(STATUS_URL, (route) =>
      fulfill(route, 200, { 'content-type': 'application/json' }, JSON.stringify(MANIFEST(false)))
    );
    const fileHeaders: Record<string, string>[] = [];
    await page.route(STORAGE_URL, (route) => {
      if (route.request().method() === 'GET') fileHeaders.push(route.request().headers());
      return fulfill(
        route,
        200,
        { 'content-type': 'application/fhir+ndjson' },
        '{"resourceType":"Observation","id":"o"}\n'
      );
    });

    await page.goto('/fhir');
    const card = page.getByTestId('bulk-export');
    await stopAutoPolling(page);
    await card.getByLabel('Status URL').fill(STATUS_URL);
    await card.getByRole('button', { name: 'Poll now' }).click();

    const storage = card.getByTestId('bulk-output').getByRole('listitem').nth(1);
    await storage.getByRole('button', { name: 'Read file' }).click();
    await expect(storage.getByTestId('bulk-file-summary')).toHaveText('1 line: 1 Observation');
    await expect(storage).toContainText('Sent without the token');
    expect(fileHeaders[0]?.['authorization']).toBeUndefined();
  });

  test('cancels an export with DELETE on the status URL', async ({ page }) => {
    await stubDiscovery(page);
    const methods: string[] = [];
    await page.route(STATUS_URL, (route) => {
      methods.push(route.request().method());
      return fulfill(route, 202);
    });

    await page.goto('/fhir');
    const card = page.getByTestId('bulk-export');
    await card.getByLabel('Status URL').fill(STATUS_URL);
    await card.getByRole('button', { name: 'Cancel export' }).click();

    await expect(card.getByTestId('bulk-cancel')).toContainText(
      'The server accepted the cancellation.'
    );
    expect(methods).toContain('DELETE');
  });
});
