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
import { parseDotEnv, settingsFromDotEnv } from './dotenv';

describe('parseDotEnv', () => {
  it('reads KEY=value to the end of the line, skipping comments and blanks', () => {
    const vars = parseDotEnv(
      '# comment\n\nSCOPES=openid patient/*.read\r\nCLIENT_ID = swiss \nnot a pair\n'
    );
    expect([...vars]).toEqual([
      ['SCOPES', 'openid patient/*.read'],
      ['CLIENT_ID', 'swiss']
    ]);
  });

  it('strips matching quotes only, and keeps the last of a repeated key', () => {
    const vars = parseDotEnv(`A="quoted"\nB='single'\nC="mixed'\nA=again`);
    expect(vars.get('A')).toBe('again');
    expect(vars.get('B')).toBe('single');
    expect(vars.get('C')).toBe(`"mixed'`);
  });

  it('keeps an = inside the value', () => {
    expect(parseDotEnv('CLIENT_SECRET=a=b==').get('CLIENT_SECRET')).toBe('a=b==');
  });
});

describe('settingsFromDotEnv', () => {
  it('maps .env names to the settings they set', () => {
    const { settings, ignored } = settingsFromDotEnv(
      'FHIRENDPOINT_URI=https://fhir.test\nISSUER_URI=https://idp.test\nCLIENT_ID=swiss'
    );
    expect(settings).toEqual({
      fhirBaseUrl: 'https://fhir.test',
      authIssuer: 'https://idp.test',
      clientId: 'swiss'
    });
    expect(ignored).toEqual([]);
  });

  it('skips an empty URL but keeps an empty secret, which means a public client', () => {
    const { settings } = settingsFromDotEnv('FHIRENDPOINT_URI=\nCLIENT_SECRET=');
    expect(settings).toEqual({ clientSecret: '' });
  });

  it('notes the deployment-only and unknown variables it leaves out', () => {
    const { settings, ignored, lines } = settingsFromDotEnv(
      'FRAME_ANCESTORS=self\nREDIRECT_URI=http://x\nCLIENT_ID=swiss'
    );
    expect(settings).toEqual({ clientId: 'swiss' });
    expect(lines).toBe(3);
    expect(ignored).toEqual([
      'FRAME_ANCESTORS is set when the container starts and cannot be changed here; ignored.',
      'REDIRECT_URI is not a setting Swiss reads; ignored.'
    ]);
  });

  it('does not let a variable name reach the object prototype', () => {
    const { settings } = settingsFromDotEnv('__proto__=x\nconstructor=y');
    expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
    expect(Object.keys(settings)).toEqual([]);
  });
});
