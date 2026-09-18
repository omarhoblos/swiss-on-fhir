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

import { expect, test, FHIR_BASE, stubDiscovery } from './fixtures';

test.describe('EHR launch parameters', () => {
  test('ignores an iss that is not an http(s) URL', async ({ page }) => {
    // iss becomes the FHIR base, the aud, and the host every discovery
    // document is fetched from. A link can supply it, so it is validated.
    await stubDiscovery(page);
    await page.goto('/launch?iss=javascript:alert(1)&launch=abc');

    // Alert titles are paragraphs, not headings.
    await expect(page.getByText('The iss parameter is not an http(s) URL')).toBeVisible();
    // The configured FHIR base is untouched.
    await expect(page.getByText('FHIR base overridden for this session')).toHaveCount(0);
    await page.goto('/config');
    await expect(page.locator('#config-fhirBaseUrl')).toHaveValue(FHIR_BASE);
  });

  test('warns when a launch would send the client secret to the iss server', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/config');
    const secret = page.locator('#config-clientSecret');
    await secret.fill('hunter2');
    // Fields commit on change, which Chromium only fires on blur.
    await secret.blur();
    await page.locator('#config-clientAuthMethod').selectOption('basic');
    // The config page's own warning proves both edits landed before leaving.
    await expect(page.getByText(/A client secret is set/)).toBeVisible();

    await page.goto('/launch?iss=https://other-ehr.test/fhir&launch=abc');
    await expect(page.getByText('Your client secret will be sent to this server')).toBeVisible();
    await expect(page.getByText('https://other-ehr.test/fhir').first()).toBeVisible();
  });

  test('does not warn about the secret for a public client', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/launch?iss=https://other-ehr.test/fhir&launch=abc');
    await expect(page.getByText('EHR launch detected')).toBeVisible();
    await expect(page.getByText('Your client secret will be sent to this server')).toHaveCount(0);
  });
});
