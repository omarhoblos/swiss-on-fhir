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
import {
  isEnvironmentId,
  isLaunchType,
  MAX_ENVIRONMENT_NAME_LENGTH,
  newEnvironmentId,
  sanitizeName
} from './types';

describe('isEnvironmentId', () => {
  it('accepts the built-in, browser and deployment shapes', () => {
    for (const id of ['default', 'env-abc123', 'deploy:partner-sandbox', 'a', '0-9']) {
      expect(isEnvironmentId(id), id).toBe(true);
    }
  });

  it('rejects anything that could break a storage key or a DOM id', () => {
    const tooLong = 'a'.repeat(65);
    for (const id of [
      '',
      'Default',
      '-leading',
      'has space',
      'dot.ted',
      'deploy:',
      'other:prefix',
      'a/b',
      '__proto__',
      tooLong,
      null,
      42,
      {}
    ]) {
      expect(isEnvironmentId(id), String(id)).toBe(false);
    }
  });
});

describe('newEnvironmentId', () => {
  it('makes valid, distinct ids without needing a secure context', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newEnvironmentId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^env-[a-z0-9]{10}$/);
      expect(isEnvironmentId(id)).toBe(true);
    }
  });
});

describe('sanitizeName', () => {
  it('keeps an ordinary name', () => {
    expect(sanitizeName('Staging (EU)')).toBe('Staging (EU)');
  });

  it('turns control characters and runs of whitespace into single spaces', () => {
    expect(sanitizeName('  Line\nbreak\t\there\u0000 ')).toBe('Line break here');
  });

  it('caps the length by characters, not code units', () => {
    const long = '😀'.repeat(MAX_ENVIRONMENT_NAME_LENGTH + 5);
    expect([...(sanitizeName(long) ?? '')].length).toBe(MAX_ENVIRONMENT_NAME_LENGTH);
  });

  it('returns null for a name that is empty once cleaned, or not a string', () => {
    for (const value of ['', '   ', '\n\t', null, undefined, 7, ['x']]) {
      expect(sanitizeName(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe('isLaunchType', () => {
  it('knows the three launch types and nothing else', () => {
    expect(['standalone', 'ehr', 'backend-services'].every(isLaunchType)).toBe(true);
    expect(isLaunchType('backend')).toBe(false);
    expect(isLaunchType(undefined)).toBe(false);
  });
});
