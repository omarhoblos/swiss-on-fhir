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

import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '$lib/config/defaults';
import { discoveryChecks } from './discovery';
import type { DiagnosticsContext } from '../types';
import type { DiscoveryDocuments } from '$lib/smart/discovery';

const issParameter = discoveryChecks.find((check) => check.id === 'disc.iss-parameter');

function context(docs: DiscoveryDocuments): DiagnosticsContext {
  return {
    config: { ...DEFAULTS },
    origin: 'http://localhost:4200',
    endpoints: {},
    docs,
    gates: null,
    documentUrls: {},
    session: null
  };
}

describe('disc.iss-parameter', () => {
  it('is registered after the OpenID configuration check it depends on', () => {
    expect(issParameter).toBeDefined();
    expect(issParameter!.dependsOn).toContain('disc.openid-configuration');
  });

  it('passes when the server advertises RFC 9207', async () => {
    const outcome = await issParameter!.run(
      context({ 'openid-configuration': { authorization_response_iss_parameter_supported: true } })
    );
    expect(outcome.status).toBe('pass');
    expect(outcome.spec?.url).toBe('https://www.rfc-editor.org/rfc/rfc9207');
  });

  it('warns, without failing, when it is absent', async () => {
    const outcome = await issParameter!.run(context({ 'openid-configuration': {} }));
    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('mix-up');
    // Reading documents already in hand makes no requests.
    expect(outcome.exchanges).toEqual([]);
  });
});
