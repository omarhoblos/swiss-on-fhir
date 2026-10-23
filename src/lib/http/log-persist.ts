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

import { isEnvironmentId } from '#lib/environments/types.ts';
import { cleanTabLabel, isTabId } from '#lib/tab-label.ts';
import type { HttpExchange } from './exchange';

/**
 * Persistence for the exchange log.
 *
 * IndexedDB rather than localStorage: the log can reach a few megabytes with
 * paginated FHIR bundles in it, which is well past the ~5MB localStorage
 * budget that the rest of Swiss also has to share.
 *
 * One record per exchange, each carrying the tab that made it. Until 3.2 the
 * whole log was one record that every tab rewrote, so the last tab to save
 * erased what the others had logged. Now a tab only ever rewrites its own
 * records, and the "All tabs" view reads everyone's.
 *
 * SECURITY: only the REDACTED form of an exchange is ever written here.
 * Exchanges hold live access and refresh tokens, and persisting those would
 * put them on disk for anyone with access to the browser profile -- the same
 * problem that was just removed for the client secret. Turning redaction off
 * affects the current page view and manual exports only; what lands on disk
 * is redacted regardless.
 */

const DB_NAME = 'swiss-log';
const DB_VERSION = 2;
const STORE = 'entries';
/** The 3.1 store: one record, `current`, holding every entry. */
const LEGACY_STORE = 'exchanges';
const LEGACY_RECORD_ID = 'current';

/** What one tab keeps. */
export const MAX_ENTRIES_PER_TAB = 200;
/** What all tabs keep together; the oldest go first. */
export const MAX_ENTRIES_TOTAL = 1000;

/** An exchange as stored: always with the tab that made it. */
export type StoredExchange = HttpExchange & { tabId: string };

export function canPersistLog(): boolean {
  return typeof indexedDB !== 'undefined';
}

function legacyEntries(record: unknown): HttpExchange[] {
  if (!record || typeof record !== 'object') return [];
  const entries = (record as { entries?: unknown }).entries;
  return Array.isArray(entries) ? (entries.filter(isStoredExchange) as HttpExchange[]) : [];
}

/**
 * Opens the database, upgrading a 3.1 log on the way: its entries become
 * records of the tab doing the upgrade, the only tab that can claim them.
 */
function openDb(tabId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('tabId', 'tabId');
        store.createIndex('startedAt', 'startedAt');
      }
      if (tx && db.objectStoreNames.contains(LEGACY_STORE)) {
        const read = tx.objectStore(LEGACY_STORE).get(LEGACY_RECORD_ID);
        read.onsuccess = () => {
          const store = tx.objectStore(STORE);
          for (const entry of legacyEntries(read.result).slice(0, MAX_ENTRIES_PER_TAB)) {
            store.put({ ...entry, tabId });
          }
          db.deleteObjectStore(LEGACY_STORE);
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the log database'));
  });
}

/** Runs `work` in one transaction and settles when it commits. */
async function inTransaction(
  tabId: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => void
): Promise<void> {
  const db = await openDb(tabId);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Log transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Log transaction aborted'));
    });
  } finally {
    db.close();
  }
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

/**
 * Replaces one tab's stored entries with `entries` and trims the whole log to
 * its cap. Callers must pass already-redacted entries.
 *
 * Returns the failure rather than swallowing it. A silent catch here hid a
 * real bug during development: the entries were Svelte `$state` proxies, and
 * IndexedDB uses structured clone, which throws DataCloneError on a Proxy --
 * so every write failed invisibly. Callers must pass plain objects (see
 * `$state.snapshot`), and a failure is surfaced in the UI.
 */
export async function saveTabLog(
  tabId: string,
  entries: HttpExchange[]
): Promise<{ error: string | null }> {
  if (!canPersistLog()) {
    return { error: 'This browser does not allow IndexedDB in this context.' };
  }
  const keep = entries.slice(0, MAX_ENTRIES_PER_TAB);
  const ids = new Set(keep.map((e) => e.id));
  try {
    await inTransaction(tabId, 'readwrite', (store) => {
      const mine = store.index('tabId').getAllKeys(tabId);
      mine.onsuccess = () => {
        for (const key of mine.result) if (!ids.has(String(key))) store.delete(key);
        for (const entry of keep) store.put({ ...entry, tabId });
        const count = store.count();
        count.onsuccess = () => {
          let excess = count.result - MAX_ENTRIES_TOTAL;
          if (excess <= 0) return;
          const oldest = store.index('startedAt').openKeyCursor();
          oldest.onsuccess = () => {
            const cursor = oldest.result;
            if (!cursor || excess <= 0) return;
            store.delete(cursor.primaryKey);
            excess -= 1;
            cursor.continue();
          };
        };
      };
    });
    return { error: null };
  } catch (cause) {
    // A full quota or a partitioned context must never break the app, but it
    // should not be invisible either.
    return { error: errorText(cause) };
  }
}

/**
 * The least the drawer needs to render a row. A record from an older build,
 * or one something else wrote, is dropped rather than rendered half-formed.
 */
export function isStoredExchange(entry: unknown): entry is HttpExchange {
  if (entry === null || typeof entry !== 'object') return false;
  const e = entry as {
    id?: unknown;
    request?: unknown;
    redactions?: unknown;
    environmentId?: unknown;
    tabId?: unknown;
    tabLabel?: unknown;
  };
  return (
    typeof e.id === 'string' &&
    e.request !== null &&
    typeof e.request === 'object' &&
    Array.isArray(e.redactions) &&
    (e.environmentId === undefined || isEnvironmentId(e.environmentId)) &&
    (e.tabId === undefined || isTabId(e.tabId)) &&
    (e.tabLabel === undefined || typeof e.tabLabel === 'string')
  );
}

/** Every tab's stored entries, newest first, with their labels cleaned. */
export async function loadLog(tabId: string): Promise<StoredExchange[]> {
  if (!canPersistLog()) return [];
  try {
    const all: unknown[] = [];
    await inTransaction(tabId, 'readonly', (store) => {
      const request = store.getAll();
      request.onsuccess = () => all.push(...request.result);
    });
    return all
      .filter((entry): entry is StoredExchange => isStoredExchange(entry) && isTabId(entry.tabId))
      .map((entry) =>
        entry.tabLabel === undefined ? entry : { ...entry, tabLabel: cleanTabLabel(entry.tabLabel) }
      )
      .sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

/** Clears this tab's entries, or every tab's with `allTabs`. */
export async function clearLog(tabId: string, options: { allTabs?: boolean } = {}): Promise<void> {
  if (!canPersistLog()) return;
  try {
    await inTransaction(tabId, 'readwrite', (store) => {
      if (options.allTabs) {
        store.clear();
        return;
      }
      const mine = store.index('tabId').getAllKeys(tabId);
      mine.onsuccess = () => {
        for (const key of mine.result) store.delete(key);
      };
    });
  } catch {
    /* nothing stored */
  }
}
