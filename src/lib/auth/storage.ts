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

import type { ConfigSnapshot, StorageMode } from '$lib/config/types';
import type { LaunchContext, SmartTokenResponse } from '$lib/smart/types';
import type { LaunchIntent } from './transaction';
import type { IdTokenCheck } from '$lib/oidc/id-token';

/**
 * Token persistence.
 *
 * Swiss holds real bearer tokens against real servers, so the tradeoffs are
 * stated plainly in the UI next to the selector:
 *
 *   session  survives reloads and the OAuth redirect, dies with the tab.
 *            Readable by any script on this origin, but not written to disk.
 *   local    survives a browser restart; tokens sit on disk until logout.
 *   memory   safest, but a reload loses the session.
 */

export interface PersistedSession {
  tokens: SmartTokenResponse;
  context: LaunchContext;
  /** Local wall-clock time the response was received. */
  obtainedAt: number;
  /** From expires_in, when the server supplied one. */
  expiresAt: number | null;
  requestedScopes: string;
  intent: LaunchIntent;
  /**
   * The config in effect when these tokens were issued, so Swiss can say
   * exactly what changed rather than silently showing tokens from one server
   * as though they belonged to another.
   */
  configSnapshot: ConfigSnapshot;
  /** Endpoints in effect, so refresh and revoke hit the right server. */
  tokenEndpoint?: string;
  revocationEndpoint?: string;
  endSessionEndpoint?: string;
  /** Kept so an ID token returned by a refresh can be checked the same way. */
  issuer?: string;
  jwksUri?: string;
  /** Every advertised `jwks_uri`, in precedence order, for the same reason. */
  jwksUris?: string[];
  /** How the ID token held up at sign-in; absent when none was issued. */
  idTokenCheck?: IdTokenCheck;
  /** Token response fields that had the wrong type and were set aside. */
  tokenFindings?: string[];
}

const KEY = 'swiss.session.v1';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether a value read back from storage has the shape of a session.
 *
 * Storage is writable by anything on this origin and survives upgrades, so
 * what comes back is input, not state. The Session page derives from these
 * fields directly; without this a truncated or hand-edited record throws in a
 * `$derived` and the app shows the error page on every load until storage is
 * cleared by hand. The fields that are read unconditionally are checked, and
 * the token fields read as strings or numbers must be those when present.
 */
export function isPersistedSession(raw: unknown): raw is PersistedSession {
  if (!isObject(raw)) return false;
  if (!isObject(raw.tokens) || typeof raw.tokens.access_token !== 'string') return false;
  for (const key of ['token_type', 'refresh_token', 'id_token', 'scope'] as const) {
    if (raw.tokens[key] !== undefined && typeof raw.tokens[key] !== 'string') return false;
  }
  if (raw.tokens.expires_in !== undefined && typeof raw.tokens.expires_in !== 'number') {
    return false;
  }
  if (!isObject(raw.context)) return false;
  if (typeof raw.obtainedAt !== 'number') return false;
  if (raw.expiresAt !== null && typeof raw.expiresAt !== 'number') return false;
  if (typeof raw.requestedScopes !== 'string') return false;
  if (!isObject(raw.intent) || typeof raw.intent.flavor !== 'string') return false;
  if (!isObject(raw.configSnapshot)) return false;
  if (
    raw.tokenFindings !== undefined &&
    !(Array.isArray(raw.tokenFindings) && raw.tokenFindings.every((f) => typeof f === 'string'))
  ) {
    return false;
  }
  return true;
}

export interface SessionStore {
  load(): PersistedSession | null;
  save(session: PersistedSession): void;
  clear(): void;
}

let memorySession: PersistedSession | null = null;

function storageFor(mode: StorageMode): Storage | null {
  try {
    if (mode === 'local') return localStorage;
    if (mode === 'session') return sessionStorage;
  } catch {
    return null;
  }
  return null;
}

export function createSessionStore(mode: StorageMode): SessionStore {
  if (mode === 'memory') {
    return {
      load: () => memorySession,
      save: (session) => {
        memorySession = session;
      },
      clear: () => {
        memorySession = null;
      }
    };
  }

  return {
    load() {
      const store = storageFor(mode);
      if (!store) return memorySession;
      try {
        const raw = store.getItem(KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (isPersistedSession(parsed)) return parsed;
        // Not a session: drop it, so the next load starts clean.
        store.removeItem(KEY);
        return null;
      } catch {
        return null;
      }
    },
    save(session) {
      const store = storageFor(mode);
      if (!store) {
        memorySession = session;
        return;
      }
      try {
        store.setItem(KEY, JSON.stringify(session));
      } catch {
        memorySession = session;
      }
    },
    clear() {
      memorySession = null;
      // Clear both, so switching storage mode cannot leave a stale copy
      // behind in the other one.
      for (const m of ['local', 'session'] as const) {
        try {
          storageFor(m)?.removeItem(KEY);
        } catch {
          /* ignore */
        }
      }
    }
  };
}

/**
 * Clears only Swiss's own keys.
 *
 * The Angular app called `sessionStorage.clear()` on logout, which wiped
 * unrelated data belonging to anything else on the origin.
 */
export function clearAllSwissKeys(): void {
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      const s = store();
      const doomed: string[] = [];
      for (let i = 0; i < s.length; i += 1) {
        const key = s.key(i);
        if (key?.startsWith('swiss.')) doomed.push(key);
      }
      for (const key of doomed) s.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
}
