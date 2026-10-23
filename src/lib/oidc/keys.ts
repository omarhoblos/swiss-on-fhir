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

/**
 * Signing keys for SMART Backend Services.
 *
 * The private key is generated NON-EXTRACTABLE and stored as a CryptoKey in
 * IndexedDB. JavaScript can sign with it but can never read it out, so an XSS
 * on this origin can use the key while the tab is open but cannot exfiltrate
 * it. The tradeoff, stated plainly in the UI: the private key cannot be
 * backed up or moved, so losing it means generating a new one and
 * re-registering the public key.
 *
 * A browser is still a weaker place to hold a signing key than a server. For
 * a tool used against servers you control that is a reasonable trade, but it
 * is a trade.
 */

import { DEFAULT_ENVIRONMENT_ID } from '#lib/environments/types.ts';

export type SigningAlg = 'RS384' | 'ES384';

const DB_NAME = 'swiss-keys';
const DB_VERSION = 1;
const STORE = 'keypairs';
/** The single record used before 3.2; moved to the Default environment. */
const LEGACY_RECORD_ID = 'backend-services';

/** How a key got here: generated in this browser, pasted or imported from a file, or shipped with the deployment. */
export type KeySource = 'generated' | 'imported' | 'deployment';

/** One record per environment, keyed by the environment's id. */
export interface StoredKeyPair {
  id: string;
  alg: SigningAlg;
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  createdAt: number;
  /** Absent in a record written before 3.2, which was generated. */
  source?: KeySource;
}

export interface KeyPairInfo {
  alg: SigningAlg;
  kid: string;
  createdAt: number;
  source: KeySource;
  /** Always false for a stored key: that is the point. */
  extractable: boolean;
}

const ALGS: readonly string[] = ['RS384', 'ES384'];
const SOURCES: readonly string[] = ['generated', 'imported', 'deployment'];

/**
 * Whether a record read back from IndexedDB is a usable key pair. IndexedDB
 * is writable by anything on this origin and survives upgrades, so a record
 * is checked before its key signs anything.
 */
export function isStoredKeyPair(raw: unknown): raw is StoredKeyPair {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  const isKey = (value: unknown) =>
    typeof CryptoKey !== 'undefined' ? value instanceof CryptoKey : Boolean(value);
  return (
    typeof r.id === 'string' &&
    typeof r.alg === 'string' &&
    ALGS.includes(r.alg) &&
    typeof r.kid === 'string' &&
    typeof r.createdAt === 'number' &&
    isKey(r.privateKey) &&
    isKey(r.publicKey) &&
    (r.source === undefined || (typeof r.source === 'string' && SOURCES.includes(r.source)))
  );
}

/** SMART Backend Services permits RS384 and ES384. */
function algorithmFor(alg: SigningAlg): RsaHashedKeyGenParams | EcKeyGenParams {
  if (alg === 'RS384') {
    return {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-384'
    };
  }
  return { name: 'ECDSA', namedCurve: 'P-384' };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

let migration: Promise<void> | null = null;

/**
 * Moves the pre-3.2 key to the Default environment, once per page. A
 * CryptoKey is structured-cloneable, so the non-extractable key moves without
 * its material ever being exported. A key already filed under Default wins.
 */
function migrateLegacyRecord(): Promise<void> {
  migration ??= (async () => {
    if (typeof indexedDB === 'undefined') return;
    try {
      const legacy = await withStore<unknown>('readonly', (store) => store.get(LEGACY_RECORD_ID));
      if (!legacy) return;
      const current = await withStore<unknown>('readonly', (store) =>
        store.get(DEFAULT_ENVIRONMENT_ID)
      );
      if (!current && isStoredKeyPair(legacy)) {
        await withStore('readwrite', (store) =>
          store.put({ ...legacy, id: DEFAULT_ENVIRONMENT_ID })
        );
      }
      await withStore('readwrite', (store) => store.delete(LEGACY_RECORD_ID));
    } catch {
      // Left in place for the next page load to try again.
      migration = null;
    }
  })();
  return migration;
}

export function canGenerateKeys(): boolean {
  return Boolean(globalThis.crypto?.subtle) && typeof indexedDB !== 'undefined';
}

/**
 * Generates a key pair and stores it.
 *
 * `extractable: false` applies to the private key only; per the WebCrypto
 * spec a generated public key is always extractable, which is what lets us
 * publish the JWKS.
 */
export async function generateKeyPair(envId: string, alg: SigningAlg): Promise<KeyPairInfo> {
  if (!canGenerateKeys()) {
    throw new Error(
      'Key generation needs crypto.subtle and IndexedDB. crypto.subtle requires a secure context, so use http://localhost or HTTPS.'
    );
  }

  const pair = (await crypto.subtle.generateKey(algorithmFor(alg), false, [
    'sign',
    'verify'
  ])) as CryptoKeyPair;

  const kid = await thumbprint(pair.publicKey);
  const record: StoredKeyPair = {
    id: envId,
    alg,
    kid,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    createdAt: Date.now(),
    source: 'generated'
  };

  // CryptoKey objects are structured-cloneable, so a non-extractable key can
  // be persisted without ever exposing its material.
  await migrateLegacyRecord();
  await withStore('readwrite', (store) => store.put(record));

  return infoOf(record);
}

/**
 * Stores a key pair that came from elsewhere (an imported or a deployment
 * key) in an environment's slot, replacing what was there. The private key
 * must already be non-extractable.
 */
export async function storeKeyPair(
  envId: string,
  pair: { privateKey: CryptoKey; publicKey: CryptoKey; alg: SigningAlg; kid: string },
  source: Exclude<KeySource, 'generated'>
): Promise<KeyPairInfo> {
  if (pair.privateKey.extractable) {
    throw new Error('Refusing to store an extractable private key.');
  }
  const record: StoredKeyPair = { id: envId, ...pair, createdAt: Date.now(), source };
  await migrateLegacyRecord();
  await withStore('readwrite', (store) => store.put(record));
  return infoOf(record);
}

function infoOf(record: StoredKeyPair): KeyPairInfo {
  return {
    alg: record.alg,
    kid: record.kid,
    createdAt: record.createdAt,
    source: record.source ?? 'generated',
    extractable: record.privateKey.extractable
  };
}

/** An environment's key pair, or null when it has none or the record is unusable. */
export async function loadKeyPair(envId: string): Promise<StoredKeyPair | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    await migrateLegacyRecord();
    const record = await withStore<unknown>('readonly', (store) => store.get(envId));
    return isStoredKeyPair(record) ? record : null;
  } catch {
    return null;
  }
}

export async function deleteKeyPair(envId: string): Promise<void> {
  try {
    await migrateLegacyRecord();
    await withStore('readwrite', (store) => store.delete(envId));
  } catch {
    /* nothing stored */
  }
}

export async function keyPairInfo(envId: string): Promise<KeyPairInfo | null> {
  const record = await loadKeyPair(envId);
  return record ? infoOf(record) : null;
}

/** RFC 7638 JWK thumbprint, used as a stable `kid`. */
async function thumbprint(publicKey: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  // Canonical form: required members only, lexicographic order, no whitespace.
  const canonical =
    jwk.kty === 'RSA'
      ? JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })
      : JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return base64url(digest);
}

function base64url(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let binary = '';
  for (const byte of u8) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A published JWK.
 *
 * The DOM lib's JsonWebKey omits `kid`, which a JWKS needs, so the
 * registration shape is spelled out here.
 */
export interface PublicJwk extends JsonWebKey {
  kid: string;
  alg: SigningAlg;
  use: 'sig';
}

/** The public JWKS to register with the authorization server. */
export async function exportPublicJwks(envId: string): Promise<{ keys: PublicJwk[] } | null> {
  const record = await loadKeyPair(envId);
  if (!record) return null;

  const jwk = await crypto.subtle.exportKey('jwk', record.publicKey);

  // Strip the private/usage noise the export may include and pin the
  // registration metadata the server needs.
  delete jwk.key_ops;
  delete jwk.ext;

  return {
    keys: [
      {
        ...jwk,
        alg: record.alg,
        use: 'sig',
        kid: record.kid
      }
    ]
  };
}
