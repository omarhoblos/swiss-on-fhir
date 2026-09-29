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
  isAuthTransaction,
  loadTransaction,
  matchCallback,
  saveTransaction,
  type AuthTransaction
} from './transaction';

function validTransaction(state = 'state-1'): AuthTransaction {
  return {
    state,
    nonce: 'nonce-1',
    pkce: { verifier: 'v', challenge: 'c', method: 'S256' },
    redirectUri: 'http://localhost:4200/callback',
    clientId: 'swiss',
    requestedScopes: 'openid',
    authorizeUrl: 'https://idp.test/authorize?x=1',
    endpoints: {},
    configSnapshot: { fhirBaseUrl: 'https://fhir.test' },
    intent: { flavor: 'standalone' },
    createdAt: Date.now(),
    status: 'pending'
  } as unknown as AuthTransaction;
}

describe('isAuthTransaction', () => {
  it('accepts what saveTransaction writes', () => {
    expect(isAuthTransaction(validTransaction())).toBe(true);
    expect(isAuthTransaction(JSON.parse(JSON.stringify(validTransaction())))).toBe(true);
  });

  it('rejects values that are not a record at all', () => {
    for (const value of [null, undefined, 'tx', 42, [], [validTransaction()]]) {
      expect(isAuthTransaction(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('rejects a record missing anything the callback sends to the token endpoint', () => {
    for (const key of [
      'state',
      'pkce',
      'redirectUri',
      'clientId',
      'requestedScopes',
      'authorizeUrl',
      'endpoints',
      'configSnapshot',
      'intent',
      'createdAt',
      'status'
    ]) {
      const broken = validTransaction() as unknown as Record<string, unknown>;
      delete broken[key];
      expect(isAuthTransaction(broken), `without ${key}`).toBe(false);
    }
  });

  it('rejects a verifier that is not a string and a status it does not know', () => {
    expect(isAuthTransaction({ ...validTransaction(), pkce: { verifier: 1 } })).toBe(false);
    expect(isAuthTransaction({ ...validTransaction(), pkce: 'v' })).toBe(false);
    expect(isAuthTransaction({ ...validTransaction(), status: 'done' })).toBe(false);
  });
});

describe('loadTransaction', () => {
  // Node has no sessionStorage, so these run on the in-memory fallback the
  // module keeps for browsers that block storage.
  it('returns what was saved', () => {
    saveTransaction(validTransaction('round-trip'));
    expect(loadTransaction('round-trip')?.clientId).toBe('swiss');
    expect(matchCallback('round-trip').kind).toBe('ok');
  });

  it('reports an unknown state as no transaction', () => {
    expect(loadTransaction('never-saved')).toBeNull();
    expect(matchCallback('never-saved').kind).toBe('no-transaction');
  });

  it('drops a record that is not a transaction, and says there is none', () => {
    saveTransaction({ state: 'malformed', status: 'pending' } as unknown as AuthTransaction);
    expect(loadTransaction('malformed')).toBeNull();
    expect(matchCallback('malformed').kind).toBe('no-transaction');
  });
});
