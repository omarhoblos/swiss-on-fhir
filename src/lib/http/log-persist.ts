import type { HttpExchange } from './exchange';

/**
 * Persistence for the exchange log.
 *
 * IndexedDB rather than localStorage: the log can reach a few megabytes with
 * paginated FHIR bundles in it, which is well past the ~5MB localStorage
 * budget that the rest of Swiss also has to share.
 *
 * SECURITY: only the REDACTED form of an exchange is ever written here.
 * Exchanges hold live access and refresh tokens, and persisting those would
 * put them on disk for anyone with access to the browser profile -- the same
 * problem that was just removed for the client secret. Turning redaction off
 * affects the current page view and manual exports only; what lands on disk
 * is redacted regardless.
 */

const DB_NAME = 'swiss-log';
const DB_VERSION = 1;
const STORE = 'exchanges';
const RECORD_ID = 'current';

export function canPersistLog(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the log database'));
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
      request.onerror = () => reject(request.error ?? new Error('Log request failed'));
    });
  } finally {
    db.close();
  }
}

interface LogRecord {
  id: string;
  savedAt: number;
  entries: HttpExchange[];
}

/**
 * Replaces the stored log. Callers must pass already-redacted entries.
 *
 * Returns the failure rather than swallowing it. A silent catch here hid a
 * real bug during development: the entries were Svelte `$state` proxies, and
 * IndexedDB uses structured clone, which throws DataCloneError on a Proxy --
 * so every write failed invisibly. Callers must pass plain objects (see
 * `$state.snapshot`), and a failure is surfaced in the UI.
 */
export async function saveLog(entries: HttpExchange[]): Promise<{ error: string | null }> {
  if (!canPersistLog()) {
    return { error: 'This browser does not allow IndexedDB in this context.' };
  }
  try {
    const record: LogRecord = { id: RECORD_ID, savedAt: Date.now(), entries };
    await withStore('readwrite', (store) => store.put(record));
    return { error: null };
  } catch (cause) {
    // A full quota or a partitioned context must never break the app, but it
    // should not be invisible either.
    return { error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause) };
  }
}

export async function loadLog(): Promise<HttpExchange[]> {
  if (!canPersistLog()) return [];
  try {
    const record = await withStore<LogRecord | undefined>('readonly', (store) =>
      store.get(RECORD_ID)
    );
    return Array.isArray(record?.entries) ? record.entries : [];
  } catch {
    return [];
  }
}

export async function clearLog(): Promise<void> {
  if (!canPersistLog()) return;
  try {
    await withStore('readwrite', (store) => store.delete(RECORD_ID));
  } catch {
    /* nothing stored */
  }
}
