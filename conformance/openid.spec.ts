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

import { expect, test } from '@playwright/test';
import {
  compare,
  loadExpectations,
  writeExpectations,
  writeSummary,
  type Observation
} from './lib/expectations';
import { OpenIdSuite } from './lib/openid-suite';
import { currentAccessToken, importEnvironments, SWISS, standaloneLaunch } from './lib/swiss';

/**
 * Swiss as a relying party, against the OpenID Foundation conformance
 * suite's Basic RP plan (static client, client_secret_basic).
 *
 * Each test of the plan serves one variation of the provider; Swiss signs in
 * once per test. The suite finishes a positive test when the client calls
 * UserInfo, and fails a negative one if it does. Swiss reports problems
 * rather than refusing them, so the harness acts as a person reading Swiss
 * would: it makes that UserInfo call, with the access token Swiss obtained,
 * only when Swiss reported nothing about the sign-in. (Swiss has no UserInfo
 * client; the harness stands in for the app that would make the call.) A negative test therefore passes when Swiss
 * noticed the problem, and its expectation also names the finding Swiss
 * must have shown.
 */

const CLIENT = { client_id: 'swiss-rp', client_secret: 'swiss-rp-secret' };
const ENVIRONMENT = 'OpenID conformance suite';

test('Basic RP plan', async ({ page }) => {
  const suite = await OpenIdSuite.connect();
  test.skip(
    !suite,
    'The OpenID suite is not running. Start it with: npm run conformance:up -- openid'
  );
  if (!suite) return;

  const plan = await suite.createPlan(
    {
      alias: 'swiss',
      description: 'Swiss on FHIR conformance run',
      client: { ...CLIENT, redirect_uri: `${SWISS}/callback`, scope: 'openid profile email' }
    },
    { client_registration: 'static_client', request_type: 'plain_http_request' }
  );

  const expected = loadExpectations('openid');
  const observed: Record<string, Observation> = {};
  let imported = false;

  for (const module of plan.modules) {
    await test.step(module, async () => {
      const { id, issuer } = await suite.startModule(plan.id, module);
      await suite.waitFor(id, ['WAITING']);

      if (!imported) {
        // One environment for the whole plan: every test serves the same
        // issuer. The FHIR base is NOT the issuer: Swiss's SMART discovery
        // asks the FHIR base for smart-configuration and /metadata, and the
        // suite interrupts a test on any request it does not expect. Swiss's
        // own preview stands in, answering with its page shell.
        await importEnvironments(
          page,
          {
            swissEnvironmentsVersion: 1,
            environments: [
              {
                name: ENVIRONMENT,
                settings: {
                  fhirBaseUrl: `${SWISS}/no-fhir-server`,
                  authIssuer: issuer,
                  clientId: CLIENT.client_id,
                  clientSecret: CLIENT.client_secret,
                  clientAuthMethod: 'basic',
                  scopes: 'openid profile email',
                  audMode: 'omit'
                }
              }
            ]
          },
          ENVIRONMENT
        );
        imported = true;
      }

      const signIn = await standaloneLaunch(page);
      if (signIn.clean) await suite.callUserinfo(issuer, await currentAccessToken(page));

      const info = await suite.waitFor(id, ['FINISHED', 'INTERRUPTED'], 60_000);
      observed[module] = {
        suite: info.result ?? info.status ?? 'UNKNOWN',
        findings: signIn.findings,
        details: await suite.failures(id)
      };
    });
  }

  const problems = Object.entries(observed).flatMap(([name, o]) =>
    compare(name, expected[name], o)
  );
  if (process.env.UPDATE_EXPECTATIONS) {
    writeExpectations(
      'openid',
      'OpenID Foundation conformance suite release-v5.3.3, oidcc-client-basic-certification-test-plan (static client, client_secret_basic). Recorded with UPDATE_EXPECTATIONS=1; reasons are written by hand.',
      observed,
      expected
    );
  }
  const summary = writeSummary('openid', observed, expected, problems);
  test.info().annotations.push({ type: 'summary', description: summary });
  await suite.dispose();
  expect(problems, `See ${summary}`).toEqual([]);
});
