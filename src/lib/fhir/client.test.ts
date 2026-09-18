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
import { tokenBelongsOn } from './client';

const BASE = 'https://fhir.example/baseR4';

describe('tokenBelongsOn', () => {
  it('attaches the token to the FHIR base origin', () => {
    expect(tokenBelongsOn(new URL('https://fhir.example/baseR4/Patient'), BASE, false)).toBe(true);
    // Same origin, different path: a Bundle.link[next] on the same server.
    expect(tokenBelongsOn(new URL('https://fhir.example/other?page=2'), BASE, false)).toBe(true);
  });

  it('withholds it from any other origin by default', () => {
    for (const url of [
      'https://evil.example/Patient',
      'http://fhir.example/baseR4/Patient', // scheme differs
      'https://fhir.example:8443/baseR4' // port differs
    ]) {
      expect(tokenBelongsOn(new URL(url), BASE, false), url).toBe(false);
    }
  });

  it('sends it anywhere once the user opts in', () => {
    expect(tokenBelongsOn(new URL('https://evil.example/Patient'), BASE, true)).toBe(true);
  });

  it('withholds it when the base itself is not a URL', () => {
    expect(tokenBelongsOn(new URL('https://fhir.example/Patient'), '', false)).toBe(false);
  });
});
