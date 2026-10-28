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
import { withClientAssertion } from './assertion';
import type { ClientAuth } from './token';

describe('withClientAssertion', () => {
  it('passes any method but private_key_jwt through untouched', async () => {
    const auth: ClientAuth = { method: 'basic', clientId: 'swiss', clientSecret: 's' };
    expect(await withClientAssertion(auth, 'default', 'https://idp.test/token')).toEqual({ auth });
  });

  it('says where to get a key when the environment has none', async () => {
    // No IndexedDB here, so no key can be found, as in an environment without one.
    const result = await withClientAssertion(
      { method: 'private_key_jwt', clientId: 'swiss', clientSecret: '' },
      'default',
      'https://idp.test/token'
    );
    expect('error' in result && result.error).toMatch(/no assertion could be signed.*Launch page/);
  });
});
