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
import { advertisesIssParameter, checkIssParameter } from './iss-parameter';

const ISSUER = 'https://idp.test';

describe('checkIssParameter', () => {
  it('is silent when the server neither advertises nor sends iss', () => {
    expect(
      checkIssParameter({ received: null, expectedIssuer: ISSUER, advertised: false })
    ).toEqual([]);
  });

  it('reports a promised iss that never arrived', () => {
    const findings = checkIssParameter({
      received: null,
      expectedIssuer: ISSUER,
      advertised: true
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('sent no `iss`');
  });

  it('accepts an iss that matches the discovered issuer exactly', () => {
    expect(
      checkIssParameter({ received: ISSUER, expectedIssuer: ISSUER, advertised: true })
    ).toEqual([]);
  });

  it('reports a mismatch, including a cosmetic one, because RFC 9207 compares bytes', () => {
    const evil = checkIssParameter({
      received: 'https://evil.test',
      expectedIssuer: ISSUER,
      advertised: true
    });
    expect(evil[0]).toContain('https://evil.test');
    expect(evil[0]).toContain('mix-up');

    const slash = checkIssParameter({
      received: `${ISSUER}/`,
      expectedIssuer: ISSUER,
      advertised: false
    });
    expect(slash).toHaveLength(1);
  });

  it('says so when there is nothing to compare against', () => {
    const findings = checkIssParameter({
      received: ISSUER,
      expectedIssuer: undefined,
      advertised: false
    });
    expect(findings[0]).toContain('could not be compared');
  });
});

describe('advertisesIssParameter', () => {
  it('reads the flag from either discovery document', () => {
    expect(advertisesIssParameter({})).toBe(false);
    expect(
      advertisesIssParameter({
        'openid-configuration': { authorization_response_iss_parameter_supported: true }
      })
    ).toBe(true);
    expect(
      advertisesIssParameter({
        'smart-configuration': { authorization_response_iss_parameter_supported: true }
      })
    ).toBe(true);
    // A string "true" is not true.
    expect(
      advertisesIssParameter({
        'openid-configuration': { authorization_response_iss_parameter_supported: 'true' }
      })
    ).toBe(false);
  });
});
