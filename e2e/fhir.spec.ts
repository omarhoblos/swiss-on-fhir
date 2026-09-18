import { expect, test, FHIR_BASE, seedSession, stubDiscovery } from './fixtures';

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
    await expect(page.getByText(/Bundle with 1 entry/)).toBeVisible();
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
