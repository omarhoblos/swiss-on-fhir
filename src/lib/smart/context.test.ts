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
import { parseFhirUser, resolveLaunchContext } from './context';
import type { SmartTokenResponse } from './types';

const BASE = 'https://fhir.example/baseR4';

describe('parseFhirUser', () => {
  it('reads a relative reference against the FHIR base', () => {
    expect(parseFhirUser('Practitioner/p1', BASE)).toMatchObject({
      resourceType: 'Practitioner',
      id: 'p1',
      absolute: false,
      crossOrigin: false,
      url: 'https://fhir.example/baseR4/Practitioner/p1'
    });
  });

  it('flags an absolute reference on another origin', () => {
    expect(parseFhirUser('https://other.example/fhir/Patient/1', BASE)).toMatchObject({
      resourceType: 'Patient',
      id: '1',
      absolute: true,
      crossOrigin: true
    });
  });

  it('returns null for a claim that only looks like a URL, instead of throwing', () => {
    // The claim is server text and the session is persisted, so a throw here
    // took the Session page down on every reload.
    for (const claim of ['https://', 'http://', 'https://%', 'HTTPS://']) {
      expect(() => parseFhirUser(claim, BASE), claim).not.toThrow();
      expect(parseFhirUser(claim, BASE), claim).toBeNull();
    }
  });

  it('returns null when there is no type and id to read', () => {
    expect(parseFhirUser('', BASE)).toBeNull();
    expect(parseFhirUser('   ', BASE)).toBeNull();
    expect(parseFhirUser('Patient', BASE)).toBeNull();
    expect(parseFhirUser('https://fhir.example/', BASE)).toBeNull();
  });

  it('names a type outside the permitted set', () => {
    expect(parseFhirUser('Device/d1', BASE)?.unexpectedType).toBe('Device');
  });
});

describe('resolveLaunchContext extras', () => {
  it('keeps server keys that collide with Object.prototype members', () => {
    // JSON.parse makes `__proto__` an own property. Copying it with
    // `extras[key] = value` set the prototype instead and the entry vanished.
    const tokens = JSON.parse(
      '{"access_token":"a","token_type":"Bearer","tenant":"t1","constructor":"c","__proto__":{"polluted":true}}'
    ) as SmartTokenResponse;

    const { extras } = resolveLaunchContext(tokens);

    expect(Object.keys(extras).sort()).toEqual(['__proto__', 'constructor', 'tenant']);
    expect(Object.getPrototypeOf(extras)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('leaves the known token fields out', () => {
    const { extras } = resolveLaunchContext({
      access_token: 'a',
      token_type: 'Bearer',
      patient: 'p1',
      scope: 'openid'
    } as SmartTokenResponse);
    expect(extras).toEqual({});
  });
});
