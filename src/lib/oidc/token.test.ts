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
import { basicHeader, exchangeCode, refreshTokens, revokeToken, type ClientAuth } from './token';

const TOKEN_ENDPOINT = 'https://idp.test/token';

/** Captures the outgoing request and answers with a canned body. */
function capture(status = 200, body: unknown = { access_token: 'a1', token_type: 'Bearer' }) {
  const seen: { url?: string; init?: RequestInit; params?: URLSearchParams } = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.init = init;
    seen.params = new URLSearchParams(String(init?.body ?? ''));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  };
  return { seen, fetchImpl };
}

const publicClient: ClientAuth = { method: 'none', clientId: 'swiss', clientSecret: '' };
const bodyClient: ClientAuth = { method: 'body', clientId: 'swiss', clientSecret: 's3cret' };
const basicClient: ClientAuth = {
  method: 'basic',
  clientId: 'swiss',
  clientSecret: 's3cret',
  formEncodeCredentials: true
};

function header(init?: RequestInit, name = 'Authorization'): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.[name];
}

describe('exchangeCode', () => {
  it('posts the code-flow form with the PKCE verifier and the snapshotted redirect_uri', async () => {
    const { seen, fetchImpl } = capture();
    const result = await exchangeCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'code-1',
      redirectUri: 'http://localhost:4200/callback',
      codeVerifier: 'verifier-1',
      auth: publicClient,
      fetchImpl
    });
    expect(seen.url).toBe(TOKEN_ENDPOINT);
    expect(seen.init?.method).toBe('POST');
    expect(header(seen.init, 'Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(seen.params?.get('grant_type')).toBe('authorization_code');
    expect(seen.params?.get('code')).toBe('code-1');
    expect(seen.params?.get('redirect_uri')).toBe('http://localhost:4200/callback');
    expect(seen.params?.get('code_verifier')).toBe('verifier-1');
    expect(result.tokens?.access_token).toBe('a1');
    expect(result.error).toBeUndefined();
  });

  it('identifies a public client with client_id and no secret', async () => {
    const { seen, fetchImpl } = capture();
    await exchangeCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'c',
      redirectUri: 'r',
      codeVerifier: 'v',
      auth: publicClient,
      fetchImpl
    });
    expect(seen.params?.get('client_id')).toBe('swiss');
    expect(seen.params?.has('client_secret')).toBe(false);
    expect(header(seen.init)).toBeUndefined();
  });

  it('sends the secret in the body for the body method', async () => {
    const { seen, fetchImpl } = capture();
    await exchangeCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'c',
      redirectUri: 'r',
      codeVerifier: 'v',
      auth: bodyClient,
      fetchImpl
    });
    expect(seen.params?.get('client_id')).toBe('swiss');
    expect(seen.params?.get('client_secret')).toBe('s3cret');
    expect(header(seen.init)).toBeUndefined();
  });

  it('sends HTTP Basic for the basic method, without a duplicate client_id', async () => {
    const { seen, fetchImpl } = capture();
    await exchangeCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'c',
      redirectUri: 'r',
      codeVerifier: 'v',
      auth: basicClient,
      fetchImpl
    });
    expect(header(seen.init)).toBe(`Basic ${btoa('swiss:s3cret')}`);
    expect(seen.params?.has('client_id')).toBe(false);
    expect(seen.params?.has('client_secret')).toBe(false);
  });

  it('parses an RFC 6749 error object rather than treating it as tokens', async () => {
    const { fetchImpl } = capture(400, {
      error: 'invalid_grant',
      error_description: 'Code expired'
    });
    const result = await exchangeCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'c',
      redirectUri: 'r',
      codeVerifier: 'v',
      auth: publicClient,
      fetchImpl
    });
    expect(result.tokens).toBeUndefined();
    expect(result.error).toMatchObject({
      error: 'invalid_grant',
      error_description: 'Code expired'
    });
  });

  it('reports a body with neither tokens nor an error', async () => {
    const { fetchImpl } = capture(200, { hello: 'world' });
    const result = await exchangeCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'c',
      redirectUri: 'r',
      codeVerifier: 'v',
      auth: publicClient,
      fetchImpl
    });
    expect(result.error?.error).toBe('invalid_response');
  });
});

describe('basicHeader', () => {
  it('form-encodes the credentials per RFC 6749 §2.3.1, unless told not to', () => {
    const auth: ClientAuth = { method: 'basic', clientId: 'a b', clientSecret: 'p@ss:word' };
    expect(basicHeader(auth)).toBe(`Basic ${btoa('a%20b:p%40ss%3Aword')}`);
    expect(basicHeader({ ...auth, formEncodeCredentials: false })).toBe(
      `Basic ${btoa('a b:p@ss:word')}`
    );
  });

  it('survives characters outside Latin-1', () => {
    expect(() =>
      basicHeader({ method: 'basic', clientId: 'swiss', clientSecret: 'pässwörd€' })
    ).not.toThrow();
  });
});

describe('refreshTokens', () => {
  it('posts the refresh grant, with a narrower scope only when asked', async () => {
    const { seen, fetchImpl } = capture();
    await refreshTokens({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: 'r1',
      auth: publicClient,
      fetchImpl
    });
    expect(seen.params?.get('grant_type')).toBe('refresh_token');
    expect(seen.params?.get('refresh_token')).toBe('r1');
    expect(seen.params?.has('scope')).toBe(false);

    await refreshTokens({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: 'r1',
      auth: publicClient,
      scope: 'patient/*.read',
      fetchImpl
    });
    expect(seen.params?.get('scope')).toBe('patient/*.read');
  });
});

describe('revokeToken', () => {
  it('posts the token with its type hint per RFC 7009', async () => {
    const { seen, fetchImpl } = capture(200, {});
    await revokeToken({
      revocationEndpoint: 'https://idp.test/revoke',
      token: 'r1',
      tokenTypeHint: 'refresh_token',
      auth: bodyClient,
      fetchImpl
    });
    expect(seen.url).toBe('https://idp.test/revoke');
    expect(seen.params?.get('token')).toBe('r1');
    expect(seen.params?.get('token_type_hint')).toBe('refresh_token');
    expect(seen.params?.get('client_secret')).toBe('s3cret');
  });

  it('accepts any answer, preferring JSON, since success has no body to read', async () => {
    const { seen, fetchImpl } = capture(200, {});
    await revokeToken({
      revocationEndpoint: 'https://idp.test/revoke',
      token: 'a1',
      tokenTypeHint: 'access_token',
      auth: publicClient,
      fetchImpl
    });
    const accept = new Headers(seen.init?.headers).get('accept') ?? '';
    expect(accept).toMatch(/^application\/json\b/);
    expect(accept).toContain('*/*');
  });

  it('reads an RFC 6749 error object from a refusal', async () => {
    const { fetchImpl } = capture(400, {
      error: 'invalid_client',
      error_description: 'Unknown client'
    });
    const { exchange, error } = await revokeToken({
      revocationEndpoint: 'https://idp.test/revoke',
      token: 'a1',
      tokenTypeHint: 'access_token',
      auth: publicClient,
      fetchImpl
    });
    expect(exchange.outcome).toBe('http-error');
    expect(error).toBe('invalid_client: Unknown client');
  });
});
