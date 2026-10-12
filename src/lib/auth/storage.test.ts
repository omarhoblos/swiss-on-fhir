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
import { isPersistedSession } from './storage';

/**
 * `load()` itself needs browser storage and is covered by the e2e specs,
 * which seed a session and would fail if a valid one were rejected. What is
 * tested here is the decision it makes.
 */
function validSession(): Record<string, unknown> {
  return {
    tokens: { access_token: 'access-1', token_type: 'Bearer' },
    context: { patient: { source: 'none' } },
    obtainedAt: 1_700_000_000_000,
    expiresAt: null,
    requestedScopes: 'openid',
    intent: { flavor: 'standalone' },
    configSnapshot: { fhirBaseUrl: 'https://fhir.test' }
  };
}

describe('isPersistedSession', () => {
  it('accepts what save() writes', () => {
    expect(isPersistedSession(validSession())).toBe(true);
    expect(isPersistedSession({ ...validSession(), expiresAt: 1_700_000_360_000 })).toBe(true);
    // Round-tripped, as it is when read back.
    expect(isPersistedSession(JSON.parse(JSON.stringify(validSession())))).toBe(true);
  });

  it('rejects values that are not a record at all', () => {
    for (const value of [null, undefined, 'session', 42, true, [], [validSession()]]) {
      expect(isPersistedSession(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('rejects a record missing a field the Session page reads unconditionally', () => {
    for (const key of Object.keys(validSession())) {
      const broken = validSession();
      delete broken[key];
      expect(isPersistedSession(broken), `without ${key}`).toBe(false);
    }
  });

  it('rejects fields of the wrong type', () => {
    const cases: Record<string, unknown>[] = [
      { tokens: 'x' },
      { tokens: {} },
      { tokens: { access_token: 42 } },
      { context: null },
      { obtainedAt: '1700000000000' },
      { expiresAt: 'never' },
      { requestedScopes: ['openid'] },
      { intent: { flavor: 1 } },
      { configSnapshot: [] }
    ];
    for (const patch of cases) {
      expect(isPersistedSession({ ...validSession(), ...patch }), JSON.stringify(patch)).toBe(
        false
      );
    }
  });

  it('refuses token fields of the wrong type, which the Session page reads directly', () => {
    for (const [key, value] of [
      ['refresh_token', 123],
      ['token_type', 1],
      ['id_token', null],
      ['scope', ['a']],
      ['expires_in', '3600']
    ] as const) {
      const session = validSession();
      session.tokens = { ...(session.tokens as object), [key]: value };
      expect(isPersistedSession(session), key).toBe(false);
    }
  });
});
