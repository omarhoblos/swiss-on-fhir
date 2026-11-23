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
import { backendUsesSecret, requestBackendToken, withClientAssertion } from './assertion';
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
    expect('error' in result && result.error).toMatch(
      /no assertion could be signed.*Config screen/
    );
  });
});

describe('requestBackendToken', () => {
  const TOKEN_ENDPOINT = 'https://idp.test/token';

  function capture() {
    const seen: { headers?: Headers; params?: URLSearchParams; calls: number } = { calls: 0 };
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen.calls += 1;
      seen.headers = new Headers(init?.headers);
      seen.params = new URLSearchParams(String(init?.body ?? ''));
      return new Response(JSON.stringify({ access_token: 'backend-token', token_type: 'Bearer' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    return { seen, fetchImpl };
  }

  const params = {
    environmentId: 'default',
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: 'job',
    scope: 'system/*.rs'
  };

  it('sends the secret with HTTP Basic, and no assertion', async () => {
    const { seen, fetchImpl } = capture();
    const result = await requestBackendToken({
      ...params,
      method: 'basic',
      clientSecret: 's3cret',
      fetchImpl
    });
    expect(result.tokens?.access_token).toBe('backend-token');
    expect(result.assertion).toBeUndefined();
    expect(seen.headers?.get('authorization')).toBe(`Basic ${btoa('job:s3cret')}`);
    expect(seen.params?.get('grant_type')).toBe('client_credentials');
    expect(seen.params?.get('scope')).toBe('system/*.rs');
    expect(seen.params?.has('client_assertion')).toBe(false);
    expect(seen.params?.has('client_secret')).toBe(false);
  });

  it('sends the secret in the body for Request body', async () => {
    const { seen, fetchImpl } = capture();
    await requestBackendToken({ ...params, method: 'body', clientSecret: 's3cret', fetchImpl });
    expect(seen.headers?.has('authorization')).toBe(false);
    expect(seen.params?.get('client_id')).toBe('job');
    expect(seen.params?.get('client_secret')).toBe('s3cret');
    expect(seen.params?.has('client_assertion')).toBe(false);
  });

  it('sends an empty secret rather than refusing', async () => {
    const { seen, fetchImpl } = capture();
    await requestBackendToken({ ...params, method: 'body', fetchImpl });
    expect(seen.params?.get('client_secret')).toBe('');
  });

  it('signs an assertion for private_key_jwt, the default, and needs a key for it', async () => {
    for (const method of ['private_key_jwt', undefined] as const) {
      const { seen, fetchImpl } = capture();
      // No IndexedDB here, so no key: the request is not built.
      const result = await requestBackendToken({
        ...params,
        method,
        clientSecret: 's3cret',
        fetchImpl
      });
      expect(result.buildError).toMatch(/no signing key/);
      expect(seen.calls).toBe(0);
    }
  });

  it('says which methods send the secret', () => {
    expect(backendUsesSecret('basic')).toBe(true);
    expect(backendUsesSecret('body')).toBe(true);
    expect(backendUsesSecret('none')).toBe(false);
    expect(backendUsesSecret('private_key_jwt')).toBe(false);
    expect(backendUsesSecret(undefined)).toBe(false);
  });
});
