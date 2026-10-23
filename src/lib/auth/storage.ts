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

import type { ConfigSnapshot, StorageMode } from '#lib/config/types.ts';
import {
  DEFAULT_ENVIRONMENT_ID,
  isEnvironmentId,
  isLaunchType,
  LAUNCH_TYPES,
  type LaunchType
} from '#lib/environments/types.ts';
import type { LaunchContext, SmartTokenResponse } from '#lib/smart/types.ts';
import type { LaunchIntent } from './transaction';
import type { IdTokenCheck } from '#lib/oidc/id-token.ts';

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

/** The single-session key used before 3.2; moved into Default on load. */
export const LEGACY_SESSION_KEY = 'swiss.session.v1';

/** One session per environment and launch type. */
export const sessionKey = (envId: string, launchType: LaunchType) =>
  `${LEGACY_SESSION_KEY}.${envId}.${launchType}`;

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
  // Read unconditionally by the Session page's launch-context card.
  for (const key of ['patient', 'encounter', 'fhirUser'] as const) {
    if (!isObject(raw.context[key])) return false;
  }
  if (!isObject(raw.context.extras)) return false;
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

type Place = StorageMode;

/** Memory-mode sessions, and the fallback when storage throws, keyed like storage. */
const memorySessions = new Map<string, PersistedSession>();

function storageFor(mode: Place): Storage | null {
  try {
    if (mode === 'local') return localStorage;
    if (mode === 'session') return sessionStorage;
  } catch {
    return null;
  }
  return null;
}

function readAt(place: Place, key: string): PersistedSession | null {
  if (place === 'memory') return memorySessions.get(key) ?? null;
  const store = storageFor(place);
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isPersistedSession(parsed)) return parsed;
    // Not a session: drop it, so the next load starts clean.
    store.removeItem(key);
  } catch {
    /* unreadable: treated as absent */
  }
  return null;
}

/** Writes a session to one place; false when that place is unavailable. */
function writeAt(place: Place, key: string, session: PersistedSession): boolean {
  if (place === 'memory') {
    memorySessions.set(key, session);
    return true;
  }
  const store = storageFor(place);
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

function removeAt(place: Place, key: string): void {
  if (place === 'memory') {
    memorySessions.delete(key);
    return;
  }
  try {
    storageFor(place)?.removeItem(key);
  } catch {
    /* ignore */
  }
}

const PLACES: readonly Place[] = ['memory', 'session', 'local'];

/**
 * The store for one session slot: one environment and one launch type,
 * kept where `mode` says.
 *
 * A slot lives in exactly one place. Saving removes any copy elsewhere, and
 * loading moves a copy found elsewhere to `mode`, so changing the Token
 * storage setting moves an existing session instead of stranding it --
 * including out of storage altogether when the setting becomes memory-only.
 */
export function createSessionStore(
  mode: StorageMode,
  envId: string,
  launchType: LaunchType
): SessionStore {
  const key = sessionKey(envId, launchType);
  const save = (session: PersistedSession) => {
    // Unavailable storage (private mode, a partitioned frame) still keeps the
    // session for this page view.
    const where: Place = writeAt(mode, key, session) ? mode : 'memory';
    if (where !== mode) writeAt('memory', key, session);
    for (const place of PLACES) if (place !== where) removeAt(place, key);
  };
  return {
    load() {
      const here = readAt(mode, key);
      if (here) return here;
      for (const place of PLACES) {
        if (place === mode) continue;
        const found = readAt(place, key);
        if (found) {
          save(found);
          return found;
        }
      }
      return null;
    },
    save,
    clear() {
      for (const place of PLACES) removeAt(place, key);
    }
  };
}

/** Which launch types hold a session for an environment, in any place. */
export function storedLaunchTypes(envId: string): LaunchType[] {
  return LAUNCH_TYPES.filter((launchType) =>
    PLACES.some((place) => readAt(place, sessionKey(envId, launchType)) !== null)
  );
}

/**
 * Moves the pre-3.2 single session into the Default environment's slot for
 * the flavor it was obtained with. Checked in both storages, since either
 * could hold it; a newer session already in that slot wins.
 */
export function migrateLegacySession(): void {
  for (const place of ['session', 'local'] as const) {
    const store = storageFor(place);
    if (!store) continue;
    try {
      const raw = store.getItem(LEGACY_SESSION_KEY);
      if (raw === null) continue;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* removed below */
      }
      if (isPersistedSession(parsed) && isLaunchType(parsed.intent.flavor)) {
        const key = sessionKey(DEFAULT_ENVIRONMENT_ID, parsed.intent.flavor);
        if (store.getItem(key) === null) store.setItem(key, raw);
      }
      store.removeItem(LEGACY_SESSION_KEY);
    } catch {
      /* storage unavailable or full: left for the next load */
    }
  }
}

/** sessionStorage: which slot each environment shows in this tab, `{ envId: launchType }`. */
export const ACTIVE_SLOT_KEY = 'swiss.slot.active.v1';

function readActiveSlots(): Map<string, LaunchType> {
  const slots = new Map<string, LaunchType>();
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(ACTIVE_SLOT_KEY) ?? '{}');
    if (isObject(raw)) {
      for (const [envId, launchType] of Object.entries(raw)) {
        if (slots.size >= 100) break;
        if (isEnvironmentId(envId) && isLaunchType(launchType)) slots.set(envId, launchType);
      }
    }
  } catch {
    /* unreadable: no remembered slots */
  }
  return slots;
}

export function loadActiveSlot(envId: string): LaunchType | null {
  return readActiveSlots().get(envId) ?? null;
}

export function saveActiveSlot(envId: string, launchType: LaunchType): void {
  const slots = readActiveSlots();
  slots.set(envId, launchType);
  try {
    sessionStorage.setItem(ACTIVE_SLOT_KEY, JSON.stringify(Object.fromEntries(slots)));
  } catch {
    /* not remembered across reloads; still shown for this page view */
  }
}
