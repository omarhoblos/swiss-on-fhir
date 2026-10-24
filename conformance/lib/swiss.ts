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

import { expect, type Page } from '@playwright/test';

/**
 * Drives Swiss the way a person would: through its own pages, never by
 * writing its storage. That way a conformance run also exercises the import,
 * the picker, the Launch page and the FHIR console.
 */

export const SWISS = 'http://localhost:4173';

/** Imports an environments file on the Config page and switches to its first environment. */
export async function importEnvironments(page: Page, file: unknown, use: string) {
  await page.goto('/config');
  await page.locator('#environments-import').fill(JSON.stringify(file));
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: /^Import \d+ environments?$/ }).click();
  await expect(page.getByText(/^Imported /)).toBeVisible();
  await page.getByTestId('environment-picker').click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^✓?\\s*${escape(use)}`) }).click();
  await expect(page.getByTestId('environment-picker')).toContainText(use);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface SignIn {
  signedIn: boolean;
  /** What Swiss said: alerts on the callback page and the Session page, and the ID token verdict. */
  findings: string[];
  /** True when Swiss raised nothing: the sign-in looked sound. */
  clean: boolean;
}

/**
 * Notes that say nothing about whether the sign-in can be trusted, so a
 * person would carry on past them. Everything else counts as a finding.
 */
const BENIGN = [
  // An optional field (RFC 6749 section 5.1); Swiss falls back to `exp`.
  /no `expires_in`/,
  // About this harness having switched environments, not about the server.
  /issued under different settings/
];

/** Notes shown as alerts in the main area. */
async function alerts(page: Page): Promise<string[]> {
  return page.locator('main [role="alert"], main [role="status"]').allInnerTexts();
}

/**
 * Waits for the callback to settle and collects what Swiss reported. A
 * successful sign-in shows its warnings on the callback page for a moment,
 * then lands on the Session page, whose ID token panel holds the verdict.
 */
async function collectSignIn(page: Page): Promise<SignIn> {
  await page.waitForURL(/\/callback/, { timeout: 30_000 });
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).not.toHaveText(/Completing sign-in/, { timeout: 60_000 });
  const signedIn = (await heading.innerText()).includes('Signed in');
  const findings = await alerts(page);
  if (!signedIn) {
    findings.push(await page.locator('main').innerText());
    return { signedIn, findings, clean: false };
  }
  await page.waitForURL(`${SWISS}/`, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Access token lifetime' })).toBeVisible();
  findings.push(...(await alerts(page)));
  let verified = true;
  const panel = page.locator('details').filter({ hasText: 'ID token' }).first();
  if (await panel.count()) {
    if (!(await panel.getAttribute('open'))) await panel.locator('summary').click();
    const note = await panel.innerText();
    verified = /held up/.test(note);
    if (!verified) findings.push(note);
  }
  const relevant = findings.filter((f) => !BENIGN.some((pattern) => pattern.test(f)));
  return { signedIn, findings: relevant, clean: verified && relevant.length === 0 };
}

/**
 * The access token of the session Swiss is showing, read from its storage.
 * Read only: a suite sometimes needs the client's next request, which is not
 * something Swiss itself makes.
 */
export async function currentAccessToken(page: Page, launchType = 'standalone'): Promise<string> {
  return page.evaluate((slot) => {
    const envId = sessionStorage.getItem('swiss.envs.active.v1') ?? 'default';
    const raw = sessionStorage.getItem(`swiss.session.v1.${envId}.${slot}`);
    return raw ? (JSON.parse(raw).tokens?.access_token ?? '') : '';
  }, launchType);
}

/** A standalone launch from the Launch page, collected. */
export async function standaloneLaunch(page: Page): Promise<SignIn> {
  await page.goto('/launch');
  await page.getByLabel(/Standalone launch/).check();
  await page.getByRole('button', { name: 'Start launch' }).click();
  return collectSignIn(page);
}

/** An EHR launch: opens the URL the EHR would, then starts it. */
export async function ehrLaunch(page: Page, launchUrl: string): Promise<SignIn> {
  await page.goto(launchUrl);
  await expect(page.getByText('EHR launch detected')).toBeVisible();
  await page.getByRole('button', { name: 'Start launch' }).click();
  return collectSignIn(page);
}

/** A Backend Services token from the Launch page. */
export async function backendServicesToken(page: Page): Promise<string> {
  await page.goto('/launch');
  await page.getByLabel(/Backend services/).check();
  await page.getByRole('button', { name: 'Request access token' }).click();
  const outcome = page.getByText(/Access token obtained|did not complete|invalid_|error/i).first();
  await expect(outcome).toBeVisible({ timeout: 30_000 });
  return outcome.innerText();
}

/**
 * A GET from the FHIR console, by path or absolute URL; returns the status
 * shown. `sendTokenElsewhere` ticks the console's opt-in for an absolute URL
 * on another origin than the FHIR base, which otherwise withholds the token.
 */
export async function fhirGet(
  page: Page,
  query: string,
  options: { sendTokenElsewhere?: boolean } = {}
): Promise<string> {
  await page.goto('/fhir');
  await page.getByLabel('FHIR query').fill(query);
  if (options.sendTokenElsewhere) {
    await page.getByRole('checkbox', { name: /is not the FHIR base/ }).check();
  }
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const status = page
    .locator('main')
    .getByText(/^\d{3}$/)
    .first();
  await expect(status).toBeVisible({ timeout: 30_000 });
  return status.innerText();
}
