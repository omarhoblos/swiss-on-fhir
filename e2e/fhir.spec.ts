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

import {
  expect,
  test,
  FHIR_BASE,
  RUNTIME_CONFIG,
  seedSession,
  stubDiscovery,
  stubRuntimeConfig
} from './fixtures';

test.describe('FHIR console', () => {
  test('sends a query with a custom header and renders the result tree', async ({ page }) => {
    await stubDiscovery(page);

    let seenHeader: string | undefined;
    await page.route(`${FHIR_BASE}/Patient**`, (route) => {
      seenHeader = route.request().headers()['x-test-header'];
      return route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({
          resourceType: 'Bundle',
          type: 'searchset',
          total: 1,
          entry: [{ resource: { resourceType: 'Patient', id: 'patient-a' } }]
        })
      });
    });

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('Patient');

    await page.getByRole('button', { name: 'Add a header' }).click();
    await page.getByLabel('Header name').fill('X-Test-Header');
    await page.getByLabel('Header value').fill('present');

    await page.getByRole('button', { name: 'Send', exact: true }).click();

    await expect(page.getByText('200', { exact: true })).toBeVisible();
    await expect(page.getByText('Bundle returned with 1 total entry')).toBeVisible();
    expect(seenHeader).toBe('present');

    // The tree renders and children are collapsed beyond the default depth.
    await expect(page.getByText('resourceType')).toBeVisible();
  });

  test('reads the launch-context patient from Quick queries', async ({ page }) => {
    await stubDiscovery(page);
    await seedSession(page, {
      context: {
        patient: { value: 'patient-a', source: 'token-response' },
        encounter: { source: 'none' },
        fhirUser: { source: 'none' },
        extras: {}
      }
    });

    let authorization: string | undefined;
    await page.route(`${FHIR_BASE}/Patient/patient-a`, (route) => {
      authorization = route.request().headers()['authorization'];
      return route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'Patient', id: 'patient-a' })
      });
    });

    await page.goto('/fhir');
    const quick = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Quick queries', exact: true }) });
    await quick.getByRole('button', { name: 'Patient', exact: true }).click();

    await expect(page.getByLabel('FHIR query')).toHaveValue('Patient/patient-a');
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    expect(authorization).toBe('Bearer access-1');
  });

  test('POSTs a Bundle to the FHIR base when the query is empty', async ({ page }) => {
    await stubDiscovery(page);

    let posted: { url: string; body: unknown } | undefined;
    await page.route(FHIR_BASE, (route) => {
      posted = { url: route.request().url(), body: route.request().postDataJSON() };
      return route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'Bundle', type: 'transaction-response', entry: [] })
      });
    });

    await page.goto('/fhir');
    const send = page.getByRole('button', { name: 'Send', exact: true });

    await page.getByLabel('HTTP method').selectOption('POST');
    await page.getByLabel(/Enable write operations/).check();
    // No query and no body: nothing to send yet.
    await expect(send).toBeDisabled();

    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [] };
    await page.getByLabel('Request body').fill(JSON.stringify(bundle));
    await expect(send).toBeEnabled();
    await send.click();

    await expect(page.getByText('200', { exact: true })).toBeVisible();
    // A base with no path serialises with its root slash.
    expect(posted).toEqual({ url: `${FHIR_BASE}/`, body: bundle });
  });

  test('keeps the bearer token off other origins unless told otherwise', async ({ page }) => {
    // A typed absolute URL, or a Bundle.link[next] the server supplies, can
    // point anywhere; sending the token there hands it to that origin.
    await stubDiscovery(page);
    await seedSession(page);
    const seen: (string | undefined)[] = [];
    await page.route('https://other.test/**', (route) => {
      seen.push(route.request().headers()['authorization']);
      return route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'Patient', id: 'p' })
      });
    });

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('https://other.test/Patient/p');
    await expect(page.getByText(/is not the FHIR base, so the bearer token/)).toBeVisible();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText(/The bearer token was not sent/)).toBeVisible();
    expect(seen).toEqual([undefined]);

    await page.getByLabel(/is not the FHIR base/).check();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    expect(seen[1]).toBe('Bearer access-1');
  });

  test('still needs a query for a GET', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/fhir');
    await expect(page.getByLabel('FHIR query')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  });

  test('explains a 403 as a likely scope problem rather than a server fault', async ({ page }) => {
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/Practitioner**`, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/fhir+json',
        body: JSON.stringify({
          resourceType: 'OperationOutcome',
          issue: [
            { severity: 'error', code: 'forbidden', diagnostics: 'Denied by scope' },
            { severity: 'information', code: 'informational', diagnostics: 'Second issue' }
          ]
        })
      })
    );

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('Practitioner');
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    await expect(page.getByText('Denied by scope')).toBeVisible();
    // EVERY issue is shown; the Angular version returned only issue[0].
    await expect(page.getByText('Second issue')).toBeVisible();
    await expect(page.getByText(/may be your granted scopes, not a server fault/)).toBeVisible();
  });

  test('leaves the query field empty and lets it be cleared', async ({ page }) => {
    // It used to be seeded with "Patient" by an effect gated on the field
    // being empty, which meant clearing it snapped the value straight back
    // and the box could not be emptied at all.
    await stubDiscovery(page);
    await page.goto('/fhir');

    const query = page.getByLabel('FHIR query');
    await expect(query).toHaveValue('');
    await expect(query).toHaveAttribute('placeholder', /Patient/);
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();

    await query.fill('Observation');
    await expect(query).toHaveValue('Observation');

    await query.fill('');
    await expect(query).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  });

  test('requires explicit confirmation before a write', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/fhir');

    await page.getByLabel('HTTP method').selectOption('POST');
    await expect(page.getByText(/Enable write operations/)).toBeVisible();
    // Send stays disabled until the write is deliberately enabled.
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  });
});

test.describe('FHIR console and the session it belongs to', () => {
  test('uses the base the token was issued for, not the configured one', async ({ page }) => {
    // The configuration names one server; the session was issued by another.
    // The token belongs to the second, so that is where requests go.
    const CONFIGURED = 'https://configured.test';
    await stubRuntimeConfig(page, { ...RUNTIME_CONFIG, fhirBaseUrl: CONFIGURED });
    await stubDiscovery(page);
    await seedSession(page);

    const seen: Record<string, string | undefined> = {};
    for (const origin of [FHIR_BASE, CONFIGURED]) {
      await page.route(`${origin}/Patient/**`, (route) => {
        seen[origin] = route.request().headers()['authorization'] ?? 'none';
        return route.fulfill({
          status: 200,
          contentType: 'application/fhir+json',
          body: JSON.stringify({ resourceType: 'Patient', id: 'p' })
        });
      });
    }

    await page.goto('/fhir');
    await expect(page.getByText('Using the FHIR base this session was issued for')).toBeVisible();
    await expect(page.getByText(/Send requests to/)).toContainText(FHIR_BASE);

    await page.getByLabel('FHIR query').fill('Patient/p');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    expect(seen).toEqual({ [FHIR_BASE]: 'Bearer access-1' });

    // The configured server is still reachable by absolute URL, without the
    // token until the user says otherwise.
    await page.getByLabel('FHIR query').fill(`${CONFIGURED}/Patient/p`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText(/The bearer token was not sent/)).toBeVisible();
    expect(seen[CONFIGURED]).toBe('none');
  });

  test('uses the configured base when there is no session', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/fhir');
    await expect(page.getByText(/Send requests to/)).toContainText(FHIR_BASE);
    await expect(page.getByText('Using the FHIR base this session was issued for')).toHaveCount(0);
  });

  test('names a header that cannot be sent instead of blaming the server', async ({ page }) => {
    // fetch throws on an invalid header before anything reaches the network,
    // which used to be reported as a likely CORS problem.
    await stubDiscovery(page);

    let headers: Record<string, string> = {};
    await page.route(`${FHIR_BASE}/Patient**`, (route) => {
      headers = route.request().headers();
      return route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'Bundle', type: 'searchset', total: 0 })
      });
    });

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Add a header' }).click();
    await page.getByLabel('Header name').fill('X Bad');
    await page.getByLabel('Header value').fill('v');
    await expect(page.getByText(/Not a valid header name/)).toBeVisible();

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    expect(Object.keys(headers)).not.toContain('x bad');

    // Corrected, it is sent.
    await page.getByLabel('Header name').fill('X-Good');
    await expect(page.getByText(/Not a valid header name/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => headers['x-good']).toBe('v');
  });

  test('refuses a query that is not an http(s) URL', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText(/is not an http\(s\) URL/)).toBeVisible();
  });
});

test.describe('cancelling a FHIR request', () => {
  test('reports it as cancelled, not as a network or CORS problem', async ({ page }) => {
    await stubDiscovery(page);
    let requested = false;
    // A server that takes the request and never answers.
    await page.route(`${FHIR_BASE}/Patient**`, () => {
      requested = true;
    });

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('Cancelled before a response arrived.')).toBeVisible();
    await expect(page.getByText('The request did not complete')).toHaveCount(0);
  });

  test('a replaced request cannot overwrite the result of the one that replaced it', async ({
    page
  }) => {
    await stubDiscovery(page);
    let release: () => void = () => {};
    const slowDone = new Promise<void>((resolve) => (release = resolve));
    await page.route(`${FHIR_BASE}/Patient/slow`, async (route) => {
      await slowDone;
      await route
        .fulfill({ status: 500, contentType: 'application/fhir+json', body: '{}' })
        .catch(() => {});
    });
    await page.route(`${FHIR_BASE}/Patient/fast`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'Patient', id: 'fast' })
      })
    );

    await page.goto('/fhir');
    const query = page.getByLabel('FHIR query');
    await query.fill('Patient/slow');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await query.fill('Patient/fast');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();

    release();
    await page.waitForTimeout(500);
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    await expect(page.getByText('Patient/fast', { exact: true })).toBeVisible();
  });
});
