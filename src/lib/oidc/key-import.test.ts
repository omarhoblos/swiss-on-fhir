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

import { calculateJwkThumbprint } from 'jose';
import { describe, expect, it } from 'vitest';
import { importPrivateKey, readKeyText, type KeyImportResult } from './key-import';

async function generate(params: RsaHashedKeyGenParams | EcKeyGenParams): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
}

const rsa = (modulusLength: number): RsaHashedKeyGenParams => ({
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-384'
});
const ec = (namedCurve: string): EcKeyGenParams => ({ name: 'ECDSA', namedCurve });

async function pem(pair: CryptoKeyPair, label = 'PRIVATE KEY'): Promise<string> {
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const base64 = btoa(String.fromCharCode(...der));
  return `-----BEGIN ${label}-----\n${base64.match(/.{1,64}/g)?.join('\n')}\n-----END ${label}-----`;
}

function expectOk(
  result: KeyImportResult
): asserts result is Extract<KeyImportResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected a key, got: ${result.error}`);
}

/** The key signs, and what it signs verifies against its public half. */
async function signsAndVerifies(result: Extract<KeyImportResult, { ok: true }>) {
  const params =
    result.alg === 'RS384' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-384' };
  const data = new TextEncoder().encode('assertion');
  const signature = await crypto.subtle.sign(params, result.privateKey, data);
  return crypto.subtle.verify(params, result.publicKey, signature, data);
}

describe('importPrivateKey', () => {
  it('takes an RSA JWK, keeps its kid, and stores it non-extractable', async () => {
    const pair = await generate(rsa(2048));
    const jwk = {
      ...(await crypto.subtle.exportKey('jwk', pair.privateKey)),
      kid: 'registered-kid'
    };

    const result = await importPrivateKey({ kind: 'jwk', jwk });

    expectOk(result);
    expect(result.alg).toBe('RS384');
    expect(result.kid).toBe('registered-kid');
    expect(result.privateKey.extractable).toBe(false);
    expect(await signsAndVerifies(result)).toBe(true);
  });

  it('takes an EC P-384 PKCS#8 PEM, naming it by its thumbprint', async () => {
    const pair = await generate(ec('P-384'));
    const result = await importPrivateKey({ kind: 'pem', pem: await pem(pair) });

    expectOk(result);
    expect(result.alg).toBe('ES384');
    expect(result.privateKey.extractable).toBe(false);
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    expect(result.kid).toBe(
      await calculateJwkThumbprint({
        kty: 'EC',
        crv: publicJwk.crv as string,
        x: publicJwk.x as string,
        y: publicJwk.y as string
      })
    );
    expect(await signsAndVerifies(result)).toBe(true);
  });

  it('refuses a symmetric key', async () => {
    const result = await importPrivateKey({ kind: 'jwk', jwk: { kty: 'oct', k: 'c2VjcmV0' } });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/symmetric/);
  });

  it('refuses a public key, saying the private one is needed', async () => {
    const pair = await generate(rsa(2048));
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const result = await importPrivateKey({ kind: 'jwk', jwk });
    expect(!result.ok && result.error).toMatch(/public key/);
  });

  it('refuses another curve, and an RSA key under 2048 bits', async () => {
    const p256 = await crypto.subtle.exportKey('jwk', (await generate(ec('P-256'))).privateKey);
    const small = await crypto.subtle.exportKey('jwk', (await generate(rsa(1024))).privateKey);

    const curve = await importPrivateKey({ kind: 'jwk', jwk: p256 });
    const size = await importPrivateKey({ kind: 'jwk', jwk: small });

    expect(!curve.ok && curve.error).toMatch(/P-256.*P-384/);
    expect(!size.ok && size.error).toMatch(/1024 bits.*2048/);
  });

  it('refuses a P-256 PEM with a reason', async () => {
    const result = await importPrivateKey({
      kind: 'pem',
      pem: await pem(await generate(ec('P-256')))
    });
    expect(!result.ok && result.error).toMatch(/P-256/);
  });

  it('says how to convert PEM shapes it does not read', async () => {
    const pkcs1 = await importPrivateKey({
      kind: 'pem',
      pem: '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----'
    });
    const encrypted = await importPrivateKey({
      kind: 'pem',
      pem: '-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----'
    });
    const certificate = await importPrivateKey({
      kind: 'pem',
      pem: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'
    });
    expect(!pkcs1.ok && pkcs1.error).toMatch(/openssl pkcs8 -topk8/);
    expect(!encrypted.ok && encrypted.error).toMatch(/encrypted/);
    expect(!certificate.ok && certificate.error).toMatch(/public key or certificate/);
  });
});

describe('readKeyText', () => {
  it('tells a JWK from a PEM, and refuses anything else', () => {
    expect(readKeyText(' {"kty":"EC"} ')).toEqual({ kind: 'jwk', jwk: { kty: 'EC' } });
    expect(readKeyText('-----BEGIN PRIVATE KEY-----\nx')).toMatchObject({ kind: 'pem' });
    expect(readKeyText('')).toHaveProperty('error');
    expect(readKeyText('{not json')).toHaveProperty('error');
    expect(readKeyText('[1]')).toHaveProperty('error');
    expect(readKeyText('ssh-rsa AAAA')).toHaveProperty('error');
    expect(readKeyText('-----BEGIN' + 'x'.repeat(20_000))).toHaveProperty('error');
  });
});
