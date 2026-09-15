import type { AppConfig, StorageMode } from '$lib/config/types';
import type { LaunchContext, SmartTokenResponse } from '$lib/smart/types';
import type { LaunchIntent } from './transaction';

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
  configSnapshot: AppConfig;
  /** Endpoints in effect, so refresh and revoke hit the right server. */
  tokenEndpoint?: string;
  revocationEndpoint?: string;
  endSessionEndpoint?: string;
}

const KEY = 'swiss.session.v1';

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
        return raw ? (JSON.parse(raw) as PersistedSession) : null;
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
