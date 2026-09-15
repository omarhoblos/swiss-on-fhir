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

export type SigningAlg = 'RS384' | 'ES384';

const DB_NAME = 'swiss-keys';
const DB_VERSION = 1;
const STORE = 'keypairs';
const RECORD_ID = 'backend-services';

export interface StoredKeyPair {
  id: string;
  alg: SigningAlg;
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  createdAt: number;
}

export interface KeyPairInfo {
  alg: SigningAlg;
  kid: string;
  createdAt: number;
  /** Always false for a generated key: that is the point. */
  extractable: boolean;
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
export async function generateKeyPair(alg: SigningAlg): Promise<KeyPairInfo> {
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
    id: RECORD_ID,
    alg,
    kid,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    createdAt: Date.now()
  };

  // CryptoKey objects are structured-cloneable, so a non-extractable key can
  // be persisted without ever exposing its material.
  await withStore('readwrite', (store) => store.put(record));

  return { alg, kid, createdAt: record.createdAt, extractable: pair.privateKey.extractable };
}

export async function loadKeyPair(): Promise<StoredKeyPair | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const record = await withStore<StoredKeyPair | undefined>('readonly', (store) =>
      store.get(RECORD_ID)
    );
    return record ?? null;
  } catch {
    return null;
  }
}

export async function deleteKeyPair(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(RECORD_ID));
  } catch {
    /* nothing stored */
  }
}

export async function keyPairInfo(): Promise<KeyPairInfo | null> {
  const record = await loadKeyPair();
  if (!record) return null;
  return {
    alg: record.alg,
    kid: record.kid,
    createdAt: record.createdAt,
    extractable: record.privateKey.extractable
  };
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
export async function exportPublicJwks(): Promise<{ keys: PublicJwk[] } | null> {
  const record = await loadKeyPair();
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
