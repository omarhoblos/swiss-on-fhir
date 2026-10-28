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

import { expect, test, type Page } from '@playwright/test';
import { exportJWK, generateKeyPair } from 'jose';
import {
  compare,
  loadExpectations,
  writeExpectations,
  writeSummary,
  type Observation
} from './lib/expectations';
import { Inferno, INFERNO_FHIR, type ClientType } from './lib/inferno';
import {
  backendServicesToken,
  ehrLaunch,
  fhirGet,
  importEnvironments,
  standaloneLaunch,
  SWISS,
  type SignIn
} from './lib/swiss';

/**
 * Swiss as a SMART client, against Inferno's SMART App Launch STU2.2 client
 * suite, once per client type. Inferno plays the EHR and its authorization
 * server; for each type the harness registers Swiss's client, lets Swiss
 * sign in (standalone, then EHR launch, for the user-facing types) or get a
 * Backend Services token, reads one resource from Inferno's FHIR endpoint
 * with the token, and lets Inferno judge the requests it saw.
 */

const PATIENT = JSON.stringify({ resourceType: 'Patient', id: '85', active: true });
const SCOPES = 'openid fhirUser launch launch/patient patient/*.read';

interface Run {
  type: ClientType;
  environment: string;
  clientId: string;
}

const RUNS: Run[] = [
  { type: 'public', environment: 'Inferno public client', clientId: 'swiss-public' },
  { type: 'symmetric', environment: 'Inferno symmetric client', clientId: 'swiss-symmetric' },
  { type: 'asymmetric', environment: 'Inferno asymmetric client', clientId: 'swiss-asymmetric' },
  { type: 'backend', environment: 'Inferno Backend Services', clientId: 'swiss-backend' }
];

test('SMART App Launch STU2.2 client suite', async ({ page }) => {
  const inferno = await Inferno.connect();
  test.skip(!inferno, 'Inferno is not running. Start it with: npm run conformance:up -- inferno');
  if (!inferno) return;

  // One key for the two asymmetric clients, made here and brought into
  // Swiss through the environments file, as a team would share one.
  const pair = await generateKeyPair('ES384', { extractable: true });
  const kid = 'swiss-conformance';
  const privateJwk = { ...(await exportJWK(pair.privateKey)), kid };
  const publicJwks = JSON.stringify({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid, alg: 'ES384', use: 'sig' }]
  });
  const base = { fhirBaseUrl: INFERNO_FHIR, authIssuer: INFERNO_FHIR, scopes: SCOPES };
  await importEnvironments(
    page,
    {
      swissEnvironmentsVersion: 1,
      environments: [
        {
          name: 'Inferno public client',
          settings: { ...base, clientId: 'swiss-public', clientAuthMethod: 'none' }
        },
        {
          name: 'Inferno symmetric client',
          settings: {
            ...base,
            clientId: 'swiss-symmetric',
            clientSecret: 'swiss-symmetric-secret',
            clientAuthMethod: 'basic'
          }
        },
        {
          name: 'Inferno asymmetric client',
          settings: { ...base, clientId: 'swiss-asymmetric', clientAuthMethod: 'private_key_jwt' },
          backendServicesKey: privateJwk
        },
        {
          name: 'Inferno Backend Services',
          settings: {
            ...base,
            clientId: 'swiss-backend',
            backendClientId: 'swiss-backend',
            backendScopes: 'system/*.read',
            defaultLaunchType: 'backend-services'
          },
          backendServicesKey: privateJwk
        }
      ]
    },
    'Inferno public client'
  );

  const expected = loadExpectations('inferno');
  const observed: Record<string, Observation> = {};

  for (const run of RUNS) {
    await test.step(run.type, async () => {
      await pick(page, run.environment);
      const session = await inferno.createSession(run.type);
      await inferno.startRun(session, {
        client_id: run.clientId,
        ...(run.type === 'backend'
          ? {}
          : {
              smart_redirect_uris: `${SWISS}/callback`,
              smart_launch_urls: `${SWISS}/launch`,
              launch_context: JSON.stringify({ patient: '85' })
            }),
        ...(run.type === 'symmetric' ? { smart_client_secret: 'swiss-symmetric-secret' } : {}),
        ...(run.type === 'asymmetric' || run.type === 'backend'
          ? { smart_jwk_set: publicJwks }
          : {}),
        echoed_fhir_response: PATIENT
      });
      await inferno.waitForStatus(session, ['waiting']);

      const findings: string[] = [];
      if (run.type === 'backend') {
        findings.push(await backendServicesToken(page));
        await fhirGet(page, 'Patient/85');
      } else {
        const standalone: SignIn = await standaloneLaunch(page);
        findings.push(...standalone.findings.map((f) => `standalone: ${f}`));
        await fhirGet(page, 'Patient/85');
        const launchUrl = await inferno.sessionValue(session, 'launch_urls');
        if (launchUrl) {
          const ehr = await ehrLaunch(page, launchUrl.split('\n')[0] ?? launchUrl);
          findings.push(...ehr.findings.map((f) => `ehr: ${f}`));
          await fhirGet(page, 'Patient/85');
        }
      }

      const continuation = await inferno.sessionValue(session, 'continuation_url');
      if (continuation) await page.request.get(continuation, { maxRedirects: 0 });
      await inferno.waitForStatus(session, ['done'], 120_000);

      for (const result of await inferno.results(session)) {
        observed[`${run.type}/${result.test}`] = {
          suite: result.result.toUpperCase(),
          findings,
          details: [result.message, ...result.messages].filter(Boolean)
        };
      }
    });
  }

  const problems = Object.entries(observed).flatMap(([name, o]) =>
    compare(name, expected[name], o)
  );
  if (process.env.UPDATE_EXPECTATIONS) {
    writeExpectations(
      'inferno',
      'Inferno SMART App Launch test kit v1.0.3, SMART App Launch STU2.2 Client suite, all four client types. Recorded with UPDATE_EXPECTATIONS=1; reasons are written by hand.',
      observed,
      expected
    );
  }
  const summary = writeSummary('inferno', observed, expected, problems);
  test.info().annotations.push({ type: 'summary', description: summary });
  await inferno.dispose();
  expect(problems, `See ${summary}`).toEqual([]);
});

async function pick(page: Page, name: string) {
  const picker = page.getByTestId('environment-picker');
  if ((await picker.innerText()).includes(name)) return;
  await picker.click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^✓?\\s*${name}`) }).click();
  await expect(picker).toContainText(name);
}
