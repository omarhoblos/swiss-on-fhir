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
import { headerProblem, isValidHeaderName, isValidHeaderValue } from './headers';

describe('isValidHeaderName', () => {
  it('accepts the names people actually send', () => {
    for (const name of [
      'Accept',
      'X-Api-Key',
      'Ocp-Apim-Subscription-Key',
      'If-None-Exist',
      'x_y'
    ]) {
      expect(isValidHeaderName(name), name).toBe(true);
    }
  });

  it('accepts names that collide with Object.prototype members', () => {
    // Odd, but legal tokens: the editor must not treat them specially.
    expect(isValidHeaderName('constructor')).toBe(true);
    expect(isValidHeaderName('__proto__')).toBe(true);
  });

  it('rejects what fetch would throw on', () => {
    for (const name of ['', 'X Bad', 'Accept:', 'X-Name\r\nInjected: 1', 'naïve', 'a/b', '"q"']) {
      expect(isValidHeaderName(name), JSON.stringify(name)).toBe(false);
    }
  });

  it('agrees with the Headers constructor', () => {
    for (const name of ['Accept', 'X Bad', 'Accept:', 'x_y', 'a/b', '__proto__']) {
      let accepted = true;
      try {
        new Headers([[name, 'v']]);
      } catch {
        accepted = false;
      }
      expect(isValidHeaderName(name), name).toBe(accepted);
    }
  });
});

describe('isValidHeaderValue', () => {
  it('accepts ordinary values, including an empty one', () => {
    for (const value of ['application/fhir+json', 'Bearer a.b.c', 'return=representation', '']) {
      expect(isValidHeaderValue(value), value).toBe(true);
    }
  });

  it('rejects line breaks and NUL, which is what header injection is made of', () => {
    for (const value of ['a\r\nX-Injected: 1', 'a\nb', 'a\rb', 'a\0b']) {
      expect(isValidHeaderValue(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('headerProblem', () => {
  it('is null for a header that can be sent', () => {
    expect(headerProblem('Prefer', 'return=minimal')).toBeNull();
  });

  it('names the part that is wrong', () => {
    expect(headerProblem('X Bad', 'v')).toContain('header name');
    expect(headerProblem('X-Ok', 'a\nb')).toContain('line breaks');
  });
});
