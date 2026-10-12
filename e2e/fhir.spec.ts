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

    // The tree renders with every level open, the entry's own resourceType too.
    await expect(page.getByText('resourceType')).toHaveCount(2);
  });

  test('expands and collapses every level of the result tree', async ({ page }) => {
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/Patient**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [
            { resource: { resourceType: 'Patient', name: [{ family: 'Deepvalue' }] } },
            // Enough entries that the page scrolls once they are all open.
            ...Array.from({ length: 30 }, (_, i) => ({
              resource: { resourceType: 'Patient', id: `patient-${i}` }
            }))
          ]
        })
      })
    );

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const expandAll = page.getByRole('button', { name: 'Expand all' });

    // Every level open by default, so the deepest value is already shown.
    await expect(page.getByText('"Deepvalue"')).toBeVisible();
    const tree = page.getByTestId('response-tree');
    const capped = () => tree.evaluate((el) => getComputedStyle(el).maxHeight);
    // Expanded all, the tree is not held in a scrolling box of its own.
    expect(await capped()).toBe('none');
    expect(await tree.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);

    // Back to top appears after a scroll much shorter than a screen; it used
    // to wait for a full one, which this page, its tree scrolling in its own
    // box, rarely reached.
    await page.evaluate(() => window.scrollTo(0, 250));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(250);
    await expect(page.getByRole('button', { name: 'Back to top' })).toBeVisible();

    // Scrolled far down the expanded tree, the card's header (what was sent,
    // what came back, and the search) is still in view, under the main nav.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const header = page
      .locator('header')
      .filter({ has: page.getByRole('heading', { name: 'Response' }) });
    const navBottom = await page
      .getByRole('navigation', { name: 'Main' })
      .evaluate((el) => el.getBoundingClientRect().bottom);
    await expect
      .poll(() => header.evaluate((el) => Math.round(el.getBoundingClientRect().top)))
      .toBe(Math.round(navBottom));
    await expect(page.getByRole('searchbox', { name: 'Search the response' })).toBeInViewport();
    await expect(page.getByText('Bundle returned with 31 total entries')).toBeInViewport();

    // Collapse all leaves only the top level open.
    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(page.getByText('"Deepvalue"')).toHaveCount(0);
    expect(await capped()).not.toBe('none');
    await expect(page.getByRole('button', { name: /^\+\s*entry/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(expandAll).toBeVisible();

    // The raw view has nothing to expand.
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    await expect(expandAll).toHaveCount(0);
    await page.getByRole('button', { name: 'Tree', exact: true }).click();

    // A new response starts fully expanded again, whatever the last was.
    await expect(page.getByText('"Deepvalue"')).toHaveCount(0);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('"Deepvalue"')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse all' })).toBeVisible();
  });

  test('searches the response, narrowing the tree to the matches', async ({ page }) => {
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/Patient**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [
            { resource: { resourceType: 'Patient', id: 'patient-a', name: [{ family: 'Smith' }] } },
            { resource: { resourceType: 'Patient', id: 'patient-b', name: [{ family: 'Jones' }] } },
            { resource: { resourceType: 'Observation', id: 'obs-1', status: 'final' } }
          ]
        })
      })
    );

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Search the response' });
    const tree = page.getByTestId('response-tree');
    const status = page.locator('#response-search-status');

    // A value deep in the tree is found and opened down to.
    await search.fill('smith');
    await expect(tree.getByText('"Smith"')).toBeVisible();
    await expect(tree.getByText('"Jones"')).toHaveCount(0);
    await expect(tree.getByText('"obs-1"')).toHaveCount(0);
    await expect(status).toHaveText(/1 match\b/);

    // A key matches too, and Enter steps through the matches.
    await search.fill('ID');
    await expect(tree.getByText('"patient-a"')).toBeVisible();
    await expect(tree.getByText('"obs-1"')).toBeVisible();
    await expect(tree.getByText('"Smith"')).toHaveCount(0);
    await search.press('Enter');
    await expect(status).toHaveText(/^Match 1 of \d+/);
    await search.press('Enter');
    await expect(status).toHaveText(/^Match 2 of \d+/);
    await search.press('Shift+Enter');
    await expect(status).toHaveText(/^Match 1 of \d+/);

    // The raw view keeps its text and counts the matches in it.
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    await search.fill('patient-');
    await expect(status).toHaveText(/^2 matches/);
    await expect(page.locator('pre')).toContainText('"obs-1"');
    await page.getByRole('button', { name: 'Tree', exact: true }).click();

    await search.fill('zzqx');
    await expect(status).toHaveText('No matches for “zzqx”.');

    // Escape clears the search and the whole tree comes back.
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(tree.getByText('resourceType').first()).toBeVisible();
    await expect(status).toHaveText('');

    // So does the clear button, which leaves focus in the box.
    const clear = page.getByRole('button', { name: 'Clear search' });
    await expect(clear).toHaveCount(0);
    await search.fill('smith');
    await expect(tree.getByText('"searchset"')).toHaveCount(0);
    await clear.click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(tree.getByText('"searchset"')).toBeVisible();
    await expect(clear).toHaveCount(0);
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
    // The Patient reads only: sending one also reads other.test's /metadata,
    // anonymously, for the Request card's title.
    await page.route('https://other.test/Patient/**', (route) => {
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

    await expect(page.getByText(/Denied by scope/).first()).toBeVisible();
    // EVERY issue is shown; the Angular version returned only issue[0].
    await expect(page.getByText('Second issue').first()).toBeVisible();
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

  test.describe('a malformed or unfinished header row', () => {
    const cases: {
      title: string;
      name: string;
      value: string;
      note: RegExp;
      sent: Record<string, string>;
      notSent: string[];
    }[] = [
      {
        title: 'a name with no value',
        name: 'X-Empty',
        value: '',
        note: /No value yet, so this header is not sent/,
        sent: {},
        notSent: ['x-empty']
      },
      {
        title: 'a value of only spaces',
        name: 'X-Spaces',
        value: '   ',
        note: /No value yet, so this header is not sent/,
        sent: {},
        notSent: ['x-spaces']
      },
      {
        title: 'a value with no name',
        name: '',
        value: 'orphan',
        note: /No header name yet, so this value is not sent/,
        sent: {},
        notSent: []
      },
      {
        // fetch throws on this before anything is sent; it used to be
        // reported as a CORS failure.
        title: 'a value fetch cannot encode',
        name: 'X-Emoji',
        value: 'key🔑',
        note: /only hold Latin-1 characters.*This header will not be sent/,
        sent: {},
        notSent: ['x-emoji']
      },
      {
        title: 'a name the browser will not let a page set',
        name: 'Cookie',
        value: 'a=b',
        note: /do not let a page set Cookie.*This header will not be sent/,
        sent: {},
        notSent: []
      },
      {
        title: 'a value outside ASCII that can still be sent',
        name: 'X-Latin',
        value: 'café',
        note: /sent as single Latin-1 bytes, not UTF-8.*It will be sent as it is/,
        sent: {},
        notSent: []
      },
      {
        title: 'a value that is not what the header expects',
        name: 'If-Match',
        value: '3',
        note: /Not an entity tag.*It will be sent as it is/,
        sent: { 'if-match': '3' },
        notSent: []
      }
    ];

    for (const c of cases) {
      test(`says what happens to ${c.title}`, async ({ page }) => {
        await stubDiscovery(page);
        let headers: Record<string, string> | undefined;
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
        const name = page.getByRole('combobox', { name: 'Header name' });
        if (c.name) await name.fill(c.name);
        await name.press('Escape');
        if (c.value) await page.getByLabel('Header value').fill(c.value);
        await expect(page.getByText(c.note)).toBeVisible();

        await page.getByRole('button', { name: 'Send', exact: true }).click();
        // The request still goes, and is not blamed on the server.
        await expect(page.getByText('200', { exact: true })).toBeVisible();
        await expect(page.getByText('network-or-cors')).toHaveCount(0);
        for (const [key, value] of Object.entries(c.sent)) expect(headers?.[key]).toBe(value);
        for (const key of c.notSent) expect(Object.keys(headers ?? {})).not.toContain(key);
      });
    }

    test('sends a Basic header with only a username, and names empty credentials', async ({
      page
    }) => {
      await stubDiscovery(page);
      let authorization: string | undefined;
      await page.route(`${FHIR_BASE}/Patient**`, (route) => {
        authorization = route.request().headers()['authorization'];
        return route.fulfill({
          status: 200,
          contentType: 'application/fhir+json',
          body: JSON.stringify({ resourceType: 'Bundle', type: 'searchset', total: 0 })
        });
      });

      await page.goto('/fhir');
      await page.getByLabel('FHIR query').fill('Patient');
      await page.getByRole('button', { name: 'Add a header' }).click();
      await page.getByRole('combobox', { name: 'Header name' }).fill('Authorization');
      await expect(page.getByText('No credentials yet, so this header is not sent.')).toBeVisible();

      // RFC 7617 allows an empty password: "user:" is still credentials.
      await page.getByLabel('Username').fill('user');
      await expect(page.getByText('No credentials yet')).toHaveCount(0);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(page.getByText('200', { exact: true })).toBeVisible();
      expect(authorization).toBe(`Basic ${Buffer.from('user:').toString('base64')}`);

      // A Bearer token that would not encode is refused with a reason.
      await page.getByLabel('Authorization scheme').selectOption('Bearer');
      await page.getByLabel('Token', { exact: true }).fill('tökén🔑');
      await expect(page.getByText(/only hold Latin-1 characters/)).toBeVisible();
    });
  });

  test('encodes a Basic username and password, in place of the bearer token', async ({ page }) => {
    await stubDiscovery(page);
    await seedSession(page);

    let authorization: string | undefined;
    await page.route(`${FHIR_BASE}/Patient**`, (route) => {
      authorization = route.request().headers()['authorization'];
      return route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'Bundle', type: 'searchset', total: 0 })
      });
    });

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Add a header' }).click();

    // Picked from the list by keyboard alone.
    const name = page.getByRole('combobox', { name: 'Header name' });
    await name.fill('auth');
    await expect(name).toHaveAttribute('aria-expanded', 'true');
    await name.press('ArrowDown');
    await name.press('Enter');
    await expect(name).toHaveValue('Authorization');
    await expect(name).toHaveAttribute('aria-expanded', 'false');

    await expect(page.getByLabel('Authorization scheme')).toHaveValue('Basic');
    await page.getByLabel('Username').fill('Aladdin');
    // Not Latin-1, so a bare btoa would throw: the encoding is UTF-8.
    await page.getByLabel('Password').fill('sésame🔑');
    await expect(page.getByText(/your own Authorization header takes precedence/)).toBeVisible();

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    expect(authorization).toBe(
      `Basic ${Buffer.from('Aladdin:sésame🔑', 'utf8').toString('base64')}`
    );
  });

  test('offers values that fit the chosen header', async ({ page }) => {
    await stubDiscovery(page);

    let prefer: string | undefined;
    await page.route(`${FHIR_BASE}/Patient**`, (route) => {
      prefer = route.request().headers()['prefer'];
      return route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'Bundle', type: 'searchset', total: 0 })
      });
    });

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Add a header' }).click();
    await page.getByRole('combobox', { name: 'Header name' }).fill('Prefer');

    await page.getByRole('button', { name: 'Show suggested values' }).click();
    await page.getByRole('option', { name: /^return=minimal/ }).click();
    await expect(page.getByRole('combobox', { name: 'Header value' })).toHaveValue(
      'return=minimal'
    );

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    expect(prefer).toBe('return=minimal');
  });

  test('opens the suggestions when a box is focused', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/fhir');
    await page.getByRole('button', { name: 'Add a header' }).click();

    const name = page.getByRole('combobox', { name: 'Header name' });
    await name.focus();
    await expect(name).toHaveAttribute('aria-expanded', 'true');
    // Everything on offer, before anything is typed.
    await expect(
      page.getByRole('listbox', { name: 'known headers' }).getByRole('option')
    ).toHaveCount(11);
    await page.getByRole('option', { name: /^Prefer/ }).click();

    const value = page.getByRole('combobox', { name: 'Header value' });
    await value.focus();
    await expect(value).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('option', { name: /^return=minimal/ })).toBeVisible();

    // Escape closes it; Arrow Down brings it back without leaving the box.
    await value.press('Escape');
    await expect(value).toHaveAttribute('aria-expanded', 'false');
    await value.press('ArrowDown');
    await expect(value).toHaveAttribute('aria-expanded', 'true');
  });

  test('wipes stored credentials an hour after they were last changed', async ({ page }) => {
    await stubDiscovery(page);
    await page.clock.install({ time: new Date('2026-10-09T12:00:00Z') });

    await page.goto('/fhir');
    await page.getByRole('button', { name: 'Add a header' }).click();
    await page.getByRole('combobox', { name: 'Header name' }).fill('Authorization');
    await page.getByLabel('Username').fill('Aladdin');
    await page.getByLabel('Password').fill('open sesame');
    await page.getByLabel('Store these headers in this browser').check();
    const warning = page.getByText(/stored for an hour after you last change them/);
    await expect(warning).toBeVisible();

    // Kept across a reload while the hour runs.
    await page.reload();
    await expect(page.getByLabel('Password')).toHaveValue('open sesame');
    await expect(warning).toBeVisible();

    await page.clock.fastForward('01:00:01');
    await expect(page.getByText(/credentials were wiped after an hour/)).toBeVisible();
    await expect(page.getByLabel('Username')).toHaveValue('');
    await expect(page.getByLabel('Password')).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Header name' })).toHaveValue('Authorization');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('persistCurrentHeaders')))
      .not.toContain('open sesame');
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

test.describe('Request card title', () => {
  const heading = (page: import('@playwright/test').Page) =>
    page.locator('section > header h2').first();

  async function serveMetadata(page: import('@playwright/test').Page, body: unknown) {
    const seen: { url: string; authorization?: string }[] = [];
    await page.route(`${FHIR_BASE}/metadata**`, (route) => {
      seen.push({
        url: route.request().url(),
        authorization: route.request().headers()['authorization']
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify(body)
      });
    });
    return seen;
  }

  test('names the server from its software, over its title', async ({ page }) => {
    await seedSession(page);
    const seen = await serveMetadata(page, {
      resourceType: 'CapabilityStatement',
      title: 'Acme Clinical Data',
      software: { name: 'Acme FHIR', version: '7.4.0' }
    });

    await page.goto('/fhir');
    await expect(heading(page)).toHaveText('Request to server: Acme FHIR 7.4.0');
    // Asked once, as the session, of the base the token was issued for.
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`${FHIR_BASE}/metadata?_summary=true`);
    expect(seen[0].authorization).toBe('Bearer access-1');
  });

  test('asks the configured server without a session, and sends no token', async ({ page }) => {
    const seen = await serveMetadata(page, { software: { name: 'Acme FHIR' } });
    await page.goto('/fhir');
    await expect(heading(page)).toHaveText('Request to server: Acme FHIR');
    expect(seen[0].authorization).toBeUndefined();
  });

  test('uses the title when there is no software name', async ({ page }) => {
    await serveMetadata(page, {
      resourceType: 'CapabilityStatement',
      title: 'Acme Clinical Data',
      software: { version: '7.4.0' }
    });
    await page.goto('/fhir');
    await expect(heading(page)).toHaveText('Request to server: Acme Clinical Data');
  });

  test('is just Request when the server says neither', async ({ page }) => {
    const seen = await serveMetadata(page, {
      resourceType: 'CapabilityStatement',
      software: { version: '7.4.0' }
    });
    await page.goto('/fhir');
    await expect.poll(() => seen.length).toBe(1);
    await expect(heading(page)).toHaveText('Request');
  });

  test('follows the request bar to another server once a request is sent', async ({ page }) => {
    await seedSession(page);
    await serveMetadata(page, { software: { name: 'Acme FHIR', version: '7.4.0' } });
    const other: { path: string; authorization?: string }[] = [];
    await page.route('https://server.fire.ly/**', (route) => {
      const url = new URL(route.request().url());
      other.push({ path: url.pathname, authorization: route.request().headers()['authorization'] });
      const body = url.pathname.endsWith('/metadata')
        ? {
            resourceType: 'CapabilityStatement',
            software: { name: 'Firely Server', version: '6.2.0' }
          }
        : { resourceType: 'Bundle', type: 'searchset', entry: [] };
      return route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify(body)
      });
    });

    await page.goto('/fhir');
    await expect(heading(page)).toHaveText('Request to server: Acme FHIR 7.4.0');

    // Typing another server's URL does not ask it anything, and the title
    // stops naming the configured server.
    await page.getByLabel('FHIR query').fill('https://server.fire.ly/r4/Patient');
    await expect(heading(page)).toHaveText('Request');
    expect(other).toHaveLength(0);

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(heading(page)).toHaveText('Request to server: Firely Server 6.2.0');
    // Its /metadata is read from the base the URL names, without the token.
    const metadata = other.find((r) => r.path === '/r4/metadata');
    expect(metadata).toBeDefined();
    expect(metadata!.authorization).toBeUndefined();

    // Back to a relative path: the configured server again, with no new request.
    await page.getByLabel('FHIR query').fill('Patient');
    await expect(heading(page)).toHaveText('Request to server: Acme FHIR 7.4.0');
    await page.getByLabel('FHIR query').fill('https://server.fire.ly/r4/Observation');
    await expect(heading(page)).toHaveText('Request to server: Firely Server 6.2.0');
  });

  test('is just Request when /metadata cannot be read', async ({ page }) => {
    let asked = false;
    await page.route(`${FHIR_BASE}/metadata**`, (route) => {
      asked = true;
      return route.fulfill({ status: 401, body: '' });
    });
    await page.goto('/fhir');
    await expect.poll(() => asked).toBe(true);
    await expect(heading(page)).toHaveText('Request');
  });
});

test.describe('JSON and XML', () => {
  const XML_BUNDLE =
    '<?xml version="1.0" encoding="UTF-8"?><Bundle xmlns="http://hl7.org/fhir"><id value="b1"/>' +
    '<type value="searchset"/><total value="2"/>' +
    '<link><relation value="self"/><url value="https://fhir.test/Patient"/></link>' +
    '<link><relation value="next"/><url value="https://fhir.test/Patient?page=2"/></link>' +
    '<entry><resource><Patient><id value="patient-a"/><text><status value="generated"/>' +
    '<div xmlns="http://www.w3.org/1999/xhtml">Patient <b>A</b></div></text></Patient></resource></entry>' +
    '<entry><resource><Patient><id value="patient-b"/></Patient></resource></entry></Bundle>';
  const JSON_BUNDLE = JSON.stringify({ resourceType: 'Bundle', type: 'searchset', total: 0 });

  /** Answers in the format asked for, and records each Accept. */
  async function serveBoth(page: import('@playwright/test').Page, accepts: string[]) {
    await page.route(`${FHIR_BASE}/Patient**`, (route) => {
      const accept = route.request().headers()['accept'] ?? '';
      accepts.push(accept);
      return accept.includes('xml')
        ? route.fulfill({ status: 200, contentType: 'application/fhir+xml', body: XML_BUNDLE })
        : route.fulfill({ status: 200, contentType: 'application/fhir+json', body: JSON_BUNDLE });
    });
  }

  test('asks again in XML when the response is switched, and reads the Bundle', async ({
    page
  }) => {
    await stubDiscovery(page);
    const accepts: string[] = [];
    await serveBoth(page, accepts);

    await page.goto('/fhir');
    const format = page.getByRole('button', { name: /^Response format:/ });
    await expect(format).toHaveAccessibleName('Response format: JSON');
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Bundle returned with 0 total entries')).toBeVisible();

    // One press flips it: there is no half to aim for.
    await format.click();
    await expect(format).toHaveAccessibleName('Response format: XML');
    await expect(page.getByText('Bundle returned with 2 total entries')).toBeVisible();
    expect(accepts).toEqual(['application/fhir+json', 'application/fhir+xml']);

    // A tree, every level open, as JSON is: elements fold like JSON keys.
    const tree = page.getByTestId('response-xml-tree');
    await expect(tree.getByText('value="patient-b"')).toBeVisible();
    await expect(tree).toContainText('<Bundle xmlns="http://hl7.org/fhir">');
    await expect(tree).toContainText('<id value="b1"/>');
    const entry = tree.getByRole('button', { name: /<entry>/ }).first();
    await expect(entry).toHaveAttribute('aria-expanded', 'true');
    await entry.click();
    await expect(entry).toHaveAttribute('aria-expanded', 'false');
    await expect(tree.getByText('value="patient-a"')).toHaveCount(0);
    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(tree.getByText('value="patient-b"')).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(tree.getByText('value="patient-b"')).toBeVisible();

    // Raw: indented, with the narrative kept on one line as it came.
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    const xml = page.getByTestId('response-xml');
    await expect(xml).toContainText('<Bundle xmlns="http://hl7.org/fhir">\n  <id value="b1"/>');
    await expect(xml).toContainText(
      '<div xmlns="http://www.w3.org/1999/xhtml">Patient <b>A</b></div>'
    );
    await page.getByRole('button', { name: 'Tree', exact: true }).click();

    // The next link is read from the XML, and the next page is asked for in XML too.
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect.poll(() => accepts.length).toBe(3);
    expect(accepts[2]).toBe('application/fhir+xml');

    // And the same press flips it back.
    await format.click();
    await expect(format).toHaveAccessibleName('Response format: JSON');
    await expect.poll(() => accepts.length).toBe(4);
    expect(accepts[3]).toBe('application/fhir+json');
    await expect(page.getByText('Bundle returned with 0 total entries')).toBeVisible();
    await expect(page.getByTestId('response-tree')).toBeVisible();
  });

  test('shows the issues of an OperationOutcome sent as XML', async ({ page }) => {
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/Patient/missing`, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/fhir+xml',
        body:
          '<OperationOutcome xmlns="http://hl7.org/fhir"><issue><severity value="error"/>' +
          '<code value="not-found"/><diagnostics value="Resource Patient/missing is not known"/>' +
          '</issue></OperationOutcome>'
      })
    );

    await page.goto('/fhir');
    await page.getByRole('button', { name: 'Response format: JSON' }).click();
    await page.getByLabel('FHIR query').fill('Patient/missing');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('404', { exact: true })).toBeVisible();
    await expect(page.getByText('error/not-found')).toBeVisible();
    await expect(page.getByText(/Resource Patient\/missing is not known/).first()).toBeVisible();
  });

  test('says so when a server answers XML with JSON, or with XML that is not FHIR', async ({
    page
  }) => {
    await stubDiscovery(page);
    let body = JSON_BUNDLE;
    let contentType = 'application/fhir+json';
    await page.route(`${FHIR_BASE}/Patient**`, (route) =>
      route.fulfill({ status: 200, contentType, body })
    );

    await page.goto('/fhir');
    await page.getByRole('button', { name: 'Response format: JSON' }).click();
    await page.getByLabel('FHIR query').fill('Patient');
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await send.click();
    await expect(
      page.getByText(
        /Asked for XML; the server answered with JSON \(Content-Type: application\/fhir\+json\)/
      )
    ).toBeVisible();

    body = '<html><body>Not here</body></html>';
    contentType = 'application/xml';
    await send.click();
    await expect(page.getByText(/Not FHIR XML: the root element <html>/)).toBeVisible();

    body = '<Bundle xmlns="http://hl7.org/fhir"><id value="b1"></Bundle>';
    await send.click();
    await expect(page.getByText(/The XML did not parse/)).toBeVisible();
    await expect(page.getByTestId('response-xml')).toHaveText(body);
  });

  test('sends an XML body with its Content-Type, and checks it first', async ({ page }) => {
    await stubDiscovery(page);
    let sent: { contentType?: string; accept?: string; body: string | null } | undefined;
    await page.route(`${FHIR_BASE}/Patient`, (route) => {
      const headers = route.request().headers();
      sent = {
        contentType: headers['content-type'],
        accept: headers['accept'],
        body: route.request().postData()
      };
      return route.fulfill({ status: 201, contentType: 'application/fhir+json', body: '{}' });
    });

    await page.goto('/fhir');
    await page.getByLabel('HTTP method').selectOption('POST');
    await page.getByLabel(/Enable write operations/).check();
    await page.getByLabel('FHIR query').fill('Patient');
    const send = page.getByRole('button', { name: 'Send', exact: true });
    const format = page.getByRole('button', { name: /^Body format:/ });
    await expect(format).toHaveAccessibleName('Body format: JSON');

    // XML typed into a JSON body is offered a switch, not sent.
    const xml =
      '<Patient xmlns="http://hl7.org/fhir"><name><family value="Wonka"/></name></Patient>';
    await page.getByLabel('Request body').fill(xml);
    await expect(page.getByText('This looks like XML, not JSON.')).toBeVisible();
    await expect(send).toBeDisabled();
    await page.getByRole('button', { name: 'Switch to XML' }).click();
    await expect(format).toHaveAccessibleName('Body format: XML');
    await expect(send).toBeEnabled();

    // Malformed XML is named and not sent.
    await page
      .getByLabel('Request body')
      .fill('<Patient xmlns="http://hl7.org/fhir"><name></Patient>');
    await expect(page.getByText(/^Invalid XML:/)).toBeVisible();
    await expect(send).toBeDisabled();

    await page.getByLabel('Request body').fill(xml);
    await send.click();
    await expect(page.getByText('201', { exact: true })).toBeVisible();
    expect(sent).toEqual({
      contentType: 'application/fhir+xml',
      accept: 'application/fhir+json',
      body: xml
    });
  });

  test('does not send a write again to see its answer in another format', async ({ page }) => {
    await stubDiscovery(page);
    let requests = 0;
    await page.route(`${FHIR_BASE}/Patient`, (route) => {
      requests += 1;
      return route.fulfill({ status: 201, contentType: 'application/fhir+json', body: '{}' });
    });

    await page.goto('/fhir');
    await page.getByLabel('HTTP method').selectOption('POST');
    await page.getByLabel(/Enable write operations/).check();
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByLabel('Request body').fill('{"resourceType":"Patient"}');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('201', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Response format: JSON' }).click();
    await expect(
      page.getByText(/XML applies from the next request\. The last one was a POST/)
    ).toBeVisible();
    expect(requests).toBe(1);
  });

  test("says when the user's own Accept header overrides the switch", async ({ page }) => {
    await stubDiscovery(page);
    const accepts: string[] = [];
    await serveBoth(page, accepts);

    await page.goto('/fhir');
    await page.getByRole('button', { name: 'Add a header' }).click();
    await page.getByRole('combobox', { name: 'Header name' }).fill('accept');
    await page.getByRole('combobox', { name: 'Header name' }).press('Escape');
    await page.getByRole('combobox', { name: 'Header value' }).fill('application/json');
    await expect(page.getByText(/Your own Accept header is sent/)).toBeVisible();

    await page.getByRole('button', { name: 'Response format: JSON' }).click();
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    // Once, in the user's spelling, not joined with the switch's.
    expect(accepts).toEqual(['application/json']);
    await expect(page.getByText(/Asked for XML/)).toHaveCount(0);
  });
});

test.describe('credentials and hostile responses', () => {
  async function addHeader(page: import('@playwright/test').Page, name: string, value: string) {
    await page.getByRole('button', { name: 'Add a header' }).click();
    const box = page.getByRole('combobox', { name: 'Header name' }).last();
    await box.fill(name);
    await box.press('Escape');
    await page.getByLabel('Header value').last().fill(value);
  }

  test("keeps the user's credential headers from a next link on another host", async ({ page }) => {
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/Patient**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [],
          link: [{ relation: 'next', url: 'https://collector.test/collect?page=2' }]
        })
      })
    );
    const collected: Record<string, string>[] = [];
    const everything: Record<string, string>[] = [];
    // Answers CORS like a real collector would; only the actual requests,
    // not their preflights, are what it collects.
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    await page.route('https://collector.test/**', (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: cors });
      }
      const headers = route.request().headers();
      everything.push(headers);
      // The console also reads the other server's /metadata to name it.
      if (!new URL(route.request().url()).pathname.endsWith('/metadata')) collected.push(headers);
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'Bundle', type: 'searchset' })
      });
    });

    await page.goto('/fhir');
    await page.getByLabel('FHIR query').fill('Patient');
    await addHeader(page, 'X-Api-Key', 'k-123');
    await addHeader(page, 'Prefer', 'return=minimal');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'Next page' }).click();

    await expect.poll(() => collected.length).toBe(1);
    expect(collected[0]?.['x-api-key']).toBeUndefined();
    // Nothing that host received carried it, the server-name read included.
    expect(everything.some((h) => 'x-api-key' in h)).toBe(false);
    expect(collected[0]?.['prefer']).toBe('return=minimal');
    await expect(page.getByText(/Not sent: your X-Api-Key header/)).toBeVisible();

    // The opt-in is offered for that host even though the typed query is on
    // the FHIR base, and once ticked the next request carries the key.
    await page.getByLabel(/https:\/\/collector\.test is not the FHIR base/).check();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect.poll(() => collected.length).toBe(2);
    expect(collected[1]?.['x-api-key']).toBe('k-123');
  });

  test('warns before credentials go out over plain http, but not to this machine', async ({
    page
  }) => {
    await stubDiscovery(page);
    await page.goto('/fhir');
    const warning = page.getByText(/is plain http, so the bearer token/);

    await page.getByLabel('FHIR query').fill('http://fhir.remote.test/Patient');
    await expect(warning).toHaveCount(0); // nothing secret to send yet
    await addHeader(page, 'X-Api-Key', 'k-123');
    await expect(warning).toBeVisible();

    await page.getByLabel('FHIR query').fill('http://localhost:8000/Patient');
    await expect(warning).toHaveCount(0);
  });

  test('shows a deeply nested XML body instead of failing the request', async ({ page }) => {
    await stubDiscovery(page);
    const depth = 50_000;
    const body = `<Bundle xmlns="http://hl7.org/fhir">${'<a>'.repeat(depth)}${'</a>'.repeat(depth)}</Bundle>`;
    await page.route(`${FHIR_BASE}/Patient**`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/fhir+xml', body })
    );

    await page.goto('/fhir');
    await page.getByRole('button', { name: 'Response format: JSON' }).click();
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    await expect(page.getByText('The request could not be built')).toHaveCount(0);
    await expect(page.getByTestId('response-xml')).toBeVisible();
  });
});

test.describe('quick queries and the XML tree search', () => {
  test('asks for the CapabilityStatement with no patient and no session', async ({ page }) => {
    await stubDiscovery(page);
    let asked = 0;
    await page.route(`${FHIR_BASE}/metadata**`, (route) => {
      asked += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'CapabilityStatement', status: 'active' })
      });
    });

    await page.goto('/fhir');
    // The server name is read from /metadata when the page opens; count from here.
    await expect.poll(() => asked).toBeGreaterThan(0);
    const before = asked;
    const quick = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Quick queries', exact: true }) });
    await quick.getByRole('button', { name: 'metadata', exact: true }).click();

    await expect(page.getByLabel('FHIR query')).toHaveValue('metadata');
    await expect(page.getByText('200', { exact: true })).toBeVisible();
    await expect(page.getByTestId('response-tree')).toContainText('CapabilityStatement');
    expect(asked).toBe(before + 1);
    // The patient queries still wait for a launch context.
    await expect(quick.getByRole('button', { name: 'Patient', exact: true })).toHaveCount(0);
  });

  test('narrows the XML tree to what the search finds', async ({ page }) => {
    await stubDiscovery(page);
    await page.route(`${FHIR_BASE}/Patient**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/fhir+xml',
        body:
          '<Bundle xmlns="http://hl7.org/fhir"><entry><resource><Patient><id value="patient-a"/>' +
          '<name><family value="Wonka"/></name></Patient></resource></entry>' +
          '<entry><resource><Patient><id value="patient-b"/></Patient></resource></entry></Bundle>'
      })
    );

    await page.goto('/fhir');
    await page.getByRole('button', { name: 'Response format: JSON' }).click();
    await page.getByLabel('FHIR query').fill('Patient');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const tree = page.getByTestId('response-xml-tree');
    await expect(tree.getByText('value="patient-b"')).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search the response' }).fill('wonka');
    await expect(tree.getByText('value="Wonka"')).toBeVisible();
    await expect(tree.getByText('value="patient-b"')).toHaveCount(0);
    await expect(page.getByText(/1 match/)).toBeVisible();
  });
});

test.describe('session status in the bottom bar', () => {
  const bar = (page: import('@playwright/test').Page) =>
    page.getByRole('complementary', { name: 'Exchange log' });

  test('is absent without a session', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/fhir');
    await expect(bar(page).getByRole('link', { name: /session/i })).toHaveCount(0);
  });

  test('says a session is active, and links to the Session page', async ({ page }) => {
    await stubDiscovery(page);
    await seedSession(page);
    await page.goto('/fhir');
    const status = bar(page).getByRole('link', { name: 'Active session' });
    await expect(status).toBeVisible();
    // In the middle of the bar, which is centred on the page.
    const box = (await status.boundingBox())!;
    const middle = await page.evaluate(() => document.documentElement.clientWidth / 2);
    expect(Math.abs(box.x + box.width / 2 - middle)).toBeLessThan(4);
    await status.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Session', exact: true })).toBeVisible();
  });

  test('says when the session has expired', async ({ page }) => {
    await stubDiscovery(page);
    await seedSession(page, { expiresAt: Date.now() - 60_000 });
    await page.goto('/config');
    await expect(bar(page).getByRole('link', { name: 'Session expired' })).toBeVisible();
    await expect(bar(page).getByRole('link', { name: 'Active session' })).toHaveCount(0);
  });

  test('fits a phone screen beside the log toggle', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await stubDiscovery(page);
    await seedSession(page);
    await page.goto('/fhir');
    const status = bar(page).getByRole('link', { name: 'Active session' });
    await expect(status).toBeInViewport();
    await expect(bar(page).getByRole('button', { name: /Exchange log/ })).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ).toBe(0);
  });
});
