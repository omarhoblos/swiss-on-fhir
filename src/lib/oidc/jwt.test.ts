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
import { decodeJwt, JwtError, tryDecodeJwt } from './jwt';

const b64 = (value: string) => Buffer.from(value).toString('base64url');
const jwt = (header: string, payload: string) => `${b64(header)}.${b64(payload)}.sig`;

describe('tryDecodeJwt', () => {
  it('decodes a header and claims that are objects', () => {
    expect(tryDecodeJwt(jwt('{"alg":"RS256"}', '{"sub":"a"}'))).toEqual({
      header: { alg: 'RS256' },
      claims: { sub: 'a' }
    });
  });

  it('refuses segments that are JSON but not objects, which crashed every reader', () => {
    for (const [header, payload] of [
      ['{"alg":"RS256"}', 'null'],
      ['null', '{"sub":"a"}'],
      ['{"alg":"RS256"}', '[1]'],
      ['{"alg":"RS256"}', '42'],
      ['{"alg":"RS256"}', '"text"']
    ]) {
      expect(tryDecodeJwt(jwt(header ?? '', payload ?? '')), `${header} / ${payload}`).toBeNull();
    }
    expect(() => decodeJwt(jwt('{}', 'null'))).toThrow(JwtError);
  });
});
