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
import { isValidHeaderName } from '$lib/http/headers';
import {
  authorizationValue,
  basicProblem,
  decodeBasic,
  emptyAuth,
  encodeBasic,
  KNOWN_HEADERS,
  knownHeader,
  parseAuthorization,
  toHttpDate,
  valueHint
} from './known-headers';

describe('KNOWN_HEADERS', () => {
  it('lists only names fetch can send, once each', () => {
    const names = KNOWN_HEADERS.map((h) => h.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const h of KNOWN_HEADERS) expect(isValidHeaderName(h.name), h.name).toBe(true);
  });

  it('is found ignoring case and surrounding space', () => {
    expect(knownHeader('prefer')?.name).toBe('Prefer');
    expect(knownHeader(' AUTHORIZATION ')?.kind).toBe('authorization');
    expect(knownHeader('X-Unknown')).toBeUndefined();
  });

  it('does not treat Object.prototype names as known', () => {
    expect(knownHeader('constructor')).toBeUndefined();
    expect(knownHeader('__proto__')).toBeUndefined();
  });
});

describe('encodeBasic', () => {
  it('matches the RFC 7617 examples', () => {
    expect(encodeBasic('Aladdin', 'open sesame')).toBe('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
    // UTF-8, not Latin-1: the pound sign is two bytes.
    expect(encodeBasic('test', '123£')).toBe('Basic dGVzdDoxMjPCow==');
  });

  it('encodes characters btoa alone would throw on', () => {
    const encoded = encodeBasic('ünïcødé', 'пароль🔑');
    expect(decodeBasic(encoded.slice('Basic '.length))).toEqual({
      username: 'ünïcødé',
      password: 'пароль🔑'
    });
  });

  it('keeps a colon in the password, which only the first colon splits off', () => {
    expect(decodeBasic(encodeBasic('u', 'a:b').slice(6))).toEqual({
      username: 'u',
      password: 'a:b'
    });
  });
});

describe('basicProblem', () => {
  it('names a colon in the username and nothing else', () => {
    expect(basicProblem('user')).toBeNull();
    expect(basicProblem('us:er')).toContain('colon');
  });
});

describe('authorizationValue', () => {
  it('builds the header from the fields for each scheme', () => {
    const auth = emptyAuth();
    expect(authorizationValue({ ...auth, username: 'Aladdin', password: 'open sesame' }, '')).toBe(
      'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='
    );
    expect(authorizationValue({ ...auth, scheme: 'Bearer', token: ' abc ' }, '')).toBe(
      'Bearer abc'
    );
    expect(authorizationValue({ ...auth, scheme: 'Other' }, 'Digest x')).toBe('Digest x');
  });

  it('is empty when there is nothing to send', () => {
    expect(authorizationValue(emptyAuth(), 'ignored')).toBe('');
    expect(authorizationValue({ ...emptyAuth(), scheme: 'Bearer', token: '  ' }, '')).toBe('');
  });
});

describe('parseAuthorization', () => {
  it('reads Basic and Bearer values back into fields', () => {
    expect(parseAuthorization('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==')).toMatchObject({
      scheme: 'Basic',
      username: 'Aladdin',
      password: 'open sesame'
    });
    expect(parseAuthorization('bearer a.b.c')).toMatchObject({ scheme: 'Bearer', token: 'a.b.c' });
  });

  it('keeps anything else as Other, including Basic that does not decode', () => {
    expect(parseAuthorization('Digest username="x"').scheme).toBe('Other');
    expect(parseAuthorization('Basic !!!').scheme).toBe('Other');
    expect(parseAuthorization('Basic bm9jb2xvbg==').scheme).toBe('Other'); // "nocolon"
  });
});

describe('toHttpDate', () => {
  it('writes an IMF-fixdate in GMT', () => {
    expect(toHttpDate('2026-10-09T16:30:00Z')).toBe('Fri, 09 Oct 2026 16:30:00 GMT');
    expect(valueHint('If-Modified-Since', toHttpDate('2026-10-09T16:30'))).toBeNull();
  });

  it('is empty for something that is not a date', () => {
    expect(toHttpDate('')).toBe('');
    expect(toHttpDate('soon')).toBe('');
  });
});

describe('valueHint', () => {
  it('says nothing about unknown headers or empty values', () => {
    expect(valueHint('X-Anything', 'whatever')).toBeNull();
    expect(valueHint('If-Match', '  ')).toBeNull();
  });

  it('notes a date that is not an HTTP-date', () => {
    expect(valueHint('If-Modified-Since', '2026-10-09')).toContain('HTTP-date');
  });

  it('notes a version that is not an entity tag', () => {
    expect(valueHint('If-Match', '3')).toContain('W/"3"');
    expect(valueHint('If-Match', 'W/"3"')).toBeNull();
    expect(valueHint('If-None-Match', '*')).toBeNull();
    expect(valueHint('If-None-Match', '"a", W/"b"')).toBeNull();
  });

  it('notes a resource type or "?" in If-None-Exist', () => {
    expect(valueHint('If-None-Exist', 'Patient?identifier=x')).toContain('search parameters');
    expect(valueHint('If-None-Exist', '?identifier=x')).toContain('search parameters');
    expect(valueHint('If-None-Exist', 'identifier=http://x|1')).toBeNull();
  });
});
