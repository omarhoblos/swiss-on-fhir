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

import { beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { checkIdToken } from './id-token';

const ISSUER = 'https://idp.test';
const CLIENT = 'swiss';
const JWKS_URI = 'https://idp.test/.well-known/jwks.json';

let privateKey: CryptoKey;
let jwksBody: string;
let otherPrivateKey: CryptoKey;

/** A fetch that serves the JWKS, and refuses everything else. */
const serveJwks: typeof fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== JWKS_URI) return new Response('not found', { status: 404 });
  return new Response(jwksBody, { status: 200, headers: { 'content-type': 'application/json' } });
};

async function sign(claims: Record<string, unknown>, key: CryptoKey = privateKey) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwksBody = JSON.stringify({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] });
  otherPrivateKey = (await generateKeyPair('RS256')).privateKey;
});

describe('checkIdToken', () => {
  it('verifies a well-formed token against the advertised JWKS', async () => {
    const idToken = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u1', nonce: 'n1' });
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      expectedNonce: 'n1',
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      fetchImpl: serveJwks
    });
    expect(result).toEqual({ verified: true, findings: [] });
  });

  it('reports a nonce that does not match the one sent', async () => {
    const idToken = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u1', nonce: 'someone-elses' });
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      expectedNonce: 'n1',
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      fetchImpl: serveJwks
    });
    expect(result.verified).toBe(false);
    expect(result.findings.join(' ')).toMatch(/nonce.*does not match/);
  });

  it('reports a missing nonce when one was sent', async () => {
    const idToken = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u1' });
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      expectedNonce: 'n1',
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      fetchImpl: serveJwks
    });
    expect(result.verified).toBe(false);
    expect(result.findings.join(' ')).toMatch(/carries no `nonce`/);
  });

  it('reports a signature from a key the JWKS does not hold', async () => {
    const idToken = await sign(
      { iss: ISSUER, aud: CLIENT, sub: 'u1', nonce: 'n1' },
      otherPrivateKey
    );
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      expectedNonce: 'n1',
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      fetchImpl: serveJwks
    });
    expect(result.verified).toBe(false);
    expect(result.findings.join(' ')).toMatch(/did not verify/);
  });

  it('reports a wrong audience and a wrong issuer', async () => {
    const wrongAud = await sign({ iss: ISSUER, aud: 'another-client', sub: 'u1' });
    const wrongIss = await sign({ iss: 'https://impostor.test', aud: CLIENT, sub: 'u1' });
    for (const idToken of [wrongAud, wrongIss]) {
      const result = await checkIdToken({
        idToken,
        clientId: CLIENT,
        issuer: ISSUER,
        jwksUri: JWKS_URI,
        fetchImpl: serveJwks
      });
      expect(result.verified).toBe(false);
      expect(result.findings.join(' ')).toMatch(/did not verify/);
    }
  });

  it('says the signature was not checked when there is no JWKS to check against', async () => {
    const idToken = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u1' });
    for (const jwksUri of [undefined, 'javascript:alert(1)']) {
      const result = await checkIdToken({ idToken, clientId: CLIENT, jwksUri });
      expect(result.verified).toBe(false);
      expect(result.findings.join(' ')).toMatch(/signature was not checked/);
    }
  });

  it('never throws on garbage', async () => {
    const result = await checkIdToken({ idToken: 'not.a.jwt', clientId: CLIENT });
    expect(result.verified).toBe(false);
    expect(result.findings[0]).toMatch(/not a decodable JWT/);
  });
});
