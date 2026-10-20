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
import { checkIdToken, describeKeySetFallback } from './id-token';

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
    expect(result).toEqual({ verified: true, findings: [], at: 'sign-in', keySet: JWKS_URI });
  });

  it('requires sub, exp and iat, which OpenID Connect makes mandatory', async () => {
    const noSub = await new SignJWT({ iss: ISSUER, aud: CLIENT })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const noExp = await new SignJWT({ iss: ISSUER, aud: CLIENT, sub: 'u1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuedAt()
      .sign(privateKey);
    const noIat = await new SignJWT({ iss: ISSUER, aud: CLIENT, sub: 'u1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setExpirationTime('5m')
      .sign(privateKey);
    for (const [idToken, claim] of [
      [noSub, 'sub'],
      [noExp, 'exp'],
      [noIat, 'iat']
    ] as const) {
      const result = await checkIdToken({
        idToken,
        clientId: CLIENT,
        issuer: ISSUER,
        jwksUri: JWKS_URI,
        fetchImpl: serveJwks
      });
      expect(result.verified).toBe(false);
      expect(result.findings.join(' ')).toContain(`the token has no \`${claim}\` claim`);
    }
  });

  it('verifies a refreshed token without a nonce, and holds it to the original sub', async () => {
    // OIDC Core 12.2: a refresh need not repeat the nonce but must keep the sub.
    const sameUser = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u1' });
    const ok = await checkIdToken({
      idToken: sameUser,
      clientId: CLIENT,
      expectedSubject: 'u1',
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      fetchImpl: serveJwks,
      at: 'refresh'
    });
    expect(ok).toEqual({ verified: true, findings: [], at: 'refresh', keySet: JWKS_URI });

    const otherUser = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u2' });
    const swapped = await checkIdToken({
      idToken: otherUser,
      clientId: CLIENT,
      expectedSubject: 'u1',
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      fetchImpl: serveJwks,
      at: 'refresh'
    });
    expect(swapped.verified).toBe(false);
    expect(swapped.findings.join(' ')).toMatch(/different `sub`/);
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

  it('names a wrong audience or issuer beside the expected value, and says the signature held', async () => {
    const cases = [
      {
        claims: { iss: ISSUER, aud: 'another-client', sub: 'u1' },
        says: "`aud` is `another-client`, which does not include this client's ID, `swiss`"
      },
      {
        claims: { iss: 'https://impostor.test', aud: CLIENT, sub: 'u1' },
        says: '`iss` is `https://impostor.test`, not `https://idp.test`'
      }
    ];
    for (const { claims, says } of cases) {
      const result = await checkIdToken({
        idToken: await sign(claims),
        clientId: CLIENT,
        issuer: ISSUER,
        jwksUri: JWKS_URI,
        fetchImpl: serveJwks
      });
      expect(result.verified).toBe(false);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toContain(`The signature verified against \`${JWKS_URI}\`, but`);
      expect(result.findings[0]).toContain(says);
    }
  });

  it('says when an expired token expired', async () => {
    const exp = Math.floor(Date.now() / 1000) - 3600;
    const idToken = await new SignJWT({ iss: ISSUER, aud: CLIENT, sub: 'u1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuedAt(exp - 300)
      .setExpirationTime(exp)
      .sign(privateKey);
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      fetchImpl: serveJwks
    });
    expect(result.verified).toBe(false);
    expect(result.findings[0]).toContain(
      `the token expired at ${new Date(exp * 1000).toISOString()} (${exp})`
    );
  });

  it('says plainly that an alg: none token is unsigned, without fetching keys', async () => {
    const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const idToken = `${encode({ alg: 'none' })}.${encode({ iss: ISSUER, aud: CLIENT, sub: 'u1', iat: now, exp: now + 300 })}.`;
    let fetches = 0;
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      issuer: ISSUER,
      jwksUris: [JWKS_URI, 'https://idp.test/other-keys'],
      fetchImpl: (input, init) => {
        fetches += 1;
        return serveJwks(input, init);
      }
    });
    expect(result.verified).toBe(false);
    expect(result.findings).toEqual([expect.stringContaining('unsigned (`alg: none`)')]);
    expect(fetches).toBe(0);
  });

  it('names an algorithm off the allow-list', async () => {
    const idToken = await new SignJWT({ iss: ISSUER, aud: CLIENT, sub: 'u1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-shared-secret-of-at-least-32-bytes!'));
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      fetchImpl: serveJwks
    });
    expect(result.verified).toBe(false);
    expect(result.findings[0]).toMatch(/signed with `HS256`, which is not one of the algorithms/);
  });

  it('says the signature was not checked when there is no JWKS to check against', async () => {
    const idToken = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u1' });
    for (const jwksUri of [undefined, 'javascript:alert(1)']) {
      const result = await checkIdToken({ idToken, clientId: CLIENT, jwksUri });
      expect(result.verified).toBe(false);
      expect(result.findings.join(' ')).toMatch(/signature was not checked/);
    }
  });

  it('falls back to the next advertised key set when the preferred one does not answer', async () => {
    const idToken = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u1' });
    const dead = 'https://idp.test/keys-that-moved';
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      issuer: ISSUER,
      jwksUri: dead,
      jwksUris: [dead, JWKS_URI],
      fetchImpl: serveJwks
    });
    expect(result.verified).toBe(true);
    expect(result.keySet).toBe(JWKS_URI);
    expect(result.skippedKeySets).toEqual([dead]);
    expect(describeKeySetFallback(result)).toMatch(/did not answer/);
    // No fallback happened, so nothing to warn about.
    const direct = await checkIdToken({
      idToken,
      clientId: CLIENT,
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      jwksUris: [JWKS_URI, dead],
      fetchImpl: serveJwks
    });
    expect(direct.skippedKeySets).toBeUndefined();
    expect(describeKeySetFallback(direct)).toBeNull();
  });

  it('reports every key set it tried when none verifies', async () => {
    const idToken = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u1' }, otherPrivateKey);
    const dead = 'https://idp.test/nope';
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      issuer: ISSUER,
      jwksUris: [dead, JWKS_URI],
      fetchImpl: serveJwks
    });
    expect(result.verified).toBe(false);
    expect(result.keySet).toBeUndefined();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('any advertised key set');
    expect(result.findings[0]).toContain(dead);
    expect(result.findings[0]).toContain(JWKS_URI);
  });

  it('says the browser withheld a key set the server served without CORS', async () => {
    const idToken = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u1' });
    // The CORS request is refused; the no-cors follow-up gets an answer.
    const noCors: typeof fetch = async (_input, init) => {
      if (init?.mode === 'no-cors') return new Response(null, { status: 200 });
      throw new TypeError('Failed to fetch');
    };
    const logged: string[] = [];
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      fetchImpl: noCors,
      onExchange: (exchange) => logged.push(`${exchange.request.url} ${exchange.outcome}`)
    });
    expect(result.verified).toBe(false);
    expect(result.findings).toEqual([
      `The ID token signature was not checked: the key set at \`${JWKS_URI}\` could not be read, because the server answered without an \`Access-Control-Allow-Origin\` header for this page, so the browser withheld the keys (CORS). The exchange log has the request.`
    ]);
    expect(result.findings[0]).not.toContain('Failed to fetch');
    expect(logged).toEqual([`${JWKS_URI} network-or-cors`]);
  });

  it('says when a key set could not be reached at all', async () => {
    const idToken = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u1' });
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      }
    });
    expect(result.verified).toBe(false);
    expect(result.findings[0]).toContain(
      'could not be read, because the connection never completed, most likely because of the certificate.'
    );
  });

  it('hands every key set request to the exchange log, including the one that verified', async () => {
    const idToken = await sign({ iss: ISSUER, aud: CLIENT, sub: 'u1' });
    const dead = 'https://idp.test/keys-that-moved';
    const logged: string[] = [];
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      issuer: ISSUER,
      jwksUris: [dead, JWKS_URI],
      fetchImpl: serveJwks,
      onExchange: (exchange) => logged.push(`${exchange.request.url} ${exchange.outcome}`)
    });
    expect(result.verified).toBe(true);
    expect(logged).toEqual([`${dead} http-error`, `${JWKS_URI} ok`]);
  });

  it('does not try another key set for a claim failure', async () => {
    // The signature held up against the first key set; the audience is what
    // failed, and no other key set can change that.
    const idToken = await sign({ iss: ISSUER, aud: 'another-client', sub: 'u1' });
    let fetches = 0;
    const counting: typeof fetch = (input, init) => {
      fetches += 1;
      return serveJwks(input, init);
    };
    const result = await checkIdToken({
      idToken,
      clientId: CLIENT,
      issuer: ISSUER,
      jwksUris: [JWKS_URI, 'https://idp.test/other-keys'],
      fetchImpl: counting
    });
    expect(result.verified).toBe(false);
    expect(fetches).toBe(1);
    expect(result.findings.join(' ')).toMatch(/`aud` is `another-client`/);
  });

  it('never throws on garbage', async () => {
    const result = await checkIdToken({ idToken: 'not.a.jwt', clientId: CLIENT });
    expect(result.verified).toBe(false);
    expect(result.findings[0]).toMatch(/not a decodable JWT/);
  });
});
