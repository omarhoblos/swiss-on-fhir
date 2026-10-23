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
import { MAX_KEY_INPUT_LENGTH, type PrivateKeyInput } from '#lib/environments/format.ts';
import type { SigningAlg } from './keys';

/**
 * Brings an existing private key into an environment's Backend Services
 * slot, for a client already registered with a key Swiss did not make.
 *
 * Accepts a private JWK or a PKCS#8 PEM, RSA of at least 2048 bits (signed
 * RS384) or EC P-384 (ES384): the two SMART Backend Services requires servers
 * to accept. Whatever else arrives is refused with a reason a person can act
 * on. The key ends up NON-EXTRACTABLE, like a generated one: a PEM has to be
 * imported once as extractable to read its public half, and that copy is
 * dropped as soon as the public JWK is taken from it. The text itself is
 * never stored, logged or shown back.
 */

export interface ImportedKey {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  alg: SigningAlg;
  kid: string;
}

export type KeyImportResult = ({ ok: true } & ImportedKey) | { ok: false; error: string };

const RSA_PARAMS: RsaHashedImportParams = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' };
const EC_PARAMS: EcKeyImportParams = { name: 'ECDSA', namedCurve: 'P-384' };

/** Reads pasted text as a JWK or a PEM, before anything is imported. */
export function readKeyText(text: string): PrivateKeyInput | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Paste a private key first.' };
  if (trimmed.length > MAX_KEY_INPUT_LENGTH) {
    return {
      error: `That is ${trimmed.length} characters long; a key is at most ${MAX_KEY_INPUT_LENGTH}.`
    };
  }
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { kind: 'jwk', jwk: parsed as JsonWebKey };
      }
    } catch {
      /* reported below */
    }
    return { error: 'That looks like JSON but is not a JWK object.' };
  }
  if (trimmed.startsWith('-----BEGIN')) return { kind: 'pem', pem: trimmed };
  return { error: 'Expected a private JWK (JSON) or a PEM block starting with -----BEGIN.' };
}

function base64urlLength(value: string): number {
  return Math.floor((value.replace(/=+$/, '').length * 3) / 4);
}

/** The public members only, in a fresh object: nothing private survives into it. */
function publicPart(jwk: JsonWebKey): JsonWebKey {
  return jwk.kty === 'RSA'
    ? { kty: 'RSA', n: jwk.n, e: jwk.e }
    : { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y };
}

/** The private members needed to import, without `alg`, `use` or `key_ops`, which can only conflict. */
function privatePart(jwk: JsonWebKey): JsonWebKey {
  return jwk.kty === 'RSA'
    ? {
        kty: 'RSA',
        n: jwk.n,
        e: jwk.e,
        d: jwk.d,
        p: jwk.p,
        q: jwk.q,
        dp: jwk.dp,
        dq: jwk.dq,
        qi: jwk.qi
      }
    : { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d };
}

async function fromJwk(jwk: JsonWebKey & { kid?: unknown }): Promise<KeyImportResult> {
  let alg: SigningAlg;
  let params: RsaHashedImportParams | EcKeyImportParams;
  if (jwk.kty === 'oct') {
    return {
      ok: false,
      error:
        'That is a symmetric (oct) key. Backend Services signs with an asymmetric key: RSA, or EC on P-384.'
    };
  }
  if (jwk.kty === 'RSA') {
    if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
      return { ok: false, error: 'That RSA key is missing its modulus (n) or exponent (e).' };
    }
    const bits = base64urlLength(jwk.n) * 8;
    if (bits < 2048) {
      return {
        ok: false,
        error: `That RSA key is ${bits} bits; SMART asks for at least 2048.`
      };
    }
    alg = 'RS384';
    params = RSA_PARAMS;
  } else if (jwk.kty === 'EC') {
    if (jwk.crv !== 'P-384') {
      return {
        ok: false,
        error: `That EC key is on ${jwk.crv ?? 'an unnamed curve'}. SMART Backend Services uses ES384, which needs P-384.`
      };
    }
    alg = 'ES384';
    params = EC_PARAMS;
  } else {
    return {
      ok: false,
      error: `Keys of type "${String(jwk.kty)}" cannot be used; use RSA or EC on P-384.`
    };
  }
  if (typeof jwk.d !== 'string') {
    return {
      ok: false,
      error:
        'That is a public key. Swiss needs the private key to sign with; register the public one with your server.'
    };
  }

  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey('jwk', privatePart(jwk), params, false, ['sign']);
    publicKey = await crypto.subtle.importKey('jwk', publicPart(jwk), params, true, ['verify']);
  } catch (cause) {
    return {
      ok: false,
      error: `The key could not be read: ${cause instanceof Error ? cause.message : String(cause)}`
    };
  }
  const kid =
    typeof jwk.kid === 'string' && jwk.kid.length > 0 && jwk.kid.length <= 200
      ? jwk.kid
      : await calculateJwkThumbprint(
          publicPart(jwk) as Parameters<typeof calculateJwkThumbprint>[0]
        );
  return { ok: true, privateKey, publicKey, alg, kid };
}

function pemBody(pem: string, label: string): Uint8Array<ArrayBuffer> | null {
  const match = pem.match(new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`));
  if (!match) return null;
  try {
    const binary = atob((match[1] ?? '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function fromPem(pem: string): Promise<KeyImportResult> {
  const label = pem.match(/-----BEGIN ([A-Z0-9 ]+)-----/)?.[1] ?? '';
  if (label === 'RSA PRIVATE KEY' || label === 'EC PRIVATE KEY') {
    return {
      ok: false,
      error: `That is a "${label}" (PKCS#1 or SEC1) PEM. Convert it to PKCS#8 first: openssl pkcs8 -topk8 -nocrypt -in key.pem`
    };
  }
  if (label === 'ENCRYPTED PRIVATE KEY') {
    return {
      ok: false,
      error: 'That key is encrypted. Decrypt it first: openssl pkcs8 -in key.pem -nocrypt'
    };
  }
  if (label === 'PUBLIC KEY' || label === 'CERTIFICATE') {
    return {
      ok: false,
      error:
        'That is a public key or certificate. Swiss needs the private key to sign with; register the public one with your server.'
    };
  }
  const der = pemBody(pem, 'PRIVATE KEY');
  if (!der) {
    return { ok: false, error: 'Expected a "-----BEGIN PRIVATE KEY-----" (PKCS#8) block.' };
  }

  // Once, extractable, only to read the key's parameters and public half;
  // fromJwk then imports it again, non-extractable, and this copy is dropped.
  for (const params of [RSA_PARAMS, EC_PARAMS]) {
    let jwk: JsonWebKey;
    try {
      const temporary = await crypto.subtle.importKey('pkcs8', der, params, true, ['sign']);
      jwk = await crypto.subtle.exportKey('jwk', temporary);
    } catch {
      continue;
    }
    return fromJwk(jwk);
  }
  return {
    ok: false,
    error:
      'That key could not be read as RSA or as EC on P-384. Backend Services needs one of those (an EC key on another curve, such as P-256, cannot be used).'
  };
}

/** Imports a private key for Backend Services, or says why it cannot be used. */
export async function importPrivateKey(input: PrivateKeyInput): Promise<KeyImportResult> {
  if (!globalThis.crypto?.subtle) {
    return {
      ok: false,
      error:
        'Importing a key needs crypto.subtle, which exists only in a secure context: use http://localhost or HTTPS.'
    };
  }
  return input.kind === 'jwk' ? fromJwk(input.jwk) : fromPem(input.pem);
}
