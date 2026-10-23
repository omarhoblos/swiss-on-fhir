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

import { DEFAULT_ENVIRONMENT_ID, isEnvironmentId, sanitizeName } from '#lib/environments/types.ts';
import { FIELDS_BY_KEY } from './fields';
import type { AppConfig, ConfigLayer } from './types';

/**
 * Persistence for live in-app config overrides, one set per environment.
 *
 * Overrides go to localStorage so they survive a restart -- that is the point
 * of being able to reconfigure without touching .env. The client secret is
 * the deliberate exception: it goes to sessionStorage and dies with the tab
 * unless the user explicitly opts in, because a secret quietly surviving on
 * disk in a shared browser is the worst outcome here.
 *
 * Each environment has its own keys rather than one shared record, so two
 * tabs editing different environments cannot overwrite each other.
 */

/** The single-environment keys used before 3.2; moved into Default on load. */
export const LEGACY_OVERRIDES_KEY = 'swiss.config.overrides.v1';
export const LEGACY_SECRET_SESSION_KEY = 'swiss.config.secret.session.v1';
export const LEGACY_SECRET_PERSISTED_KEY = 'swiss.config.secret.persisted.v1';

/** The environments made in this browser: `[{ id, name }]`. */
export const ENVIRONMENT_INDEX_KEY = 'swiss.envs.v1';
/** sessionStorage: this tab's environment, so two tabs can use two. */
export const ACTIVE_ENVIRONMENT_KEY = 'swiss.envs.active.v1';
/** localStorage: the environment last chosen anywhere, for a new tab. */
export const LAST_ACTIVE_ENVIRONMENT_KEY = 'swiss.envs.lastActive.v1';

export const overridesKey = (envId: string) => `swiss.env.v1.${envId}.overrides`;
export const secretSessionKey = (envId: string) => `${LEGACY_SECRET_SESSION_KEY}.${envId}`;
export const secretPersistedKey = (envId: string) => `${LEGACY_SECRET_PERSISTED_KEY}.${envId}`;

/** More than anyone keeps by hand; a cap on what a storage value can make us build. */
export const MAX_ENVIRONMENTS = 100;

type Area = 'local' | 'session';

function area(storage: Area): Storage {
  return storage === 'local' ? localStorage : sessionStorage;
}

function safeGet(storage: Area, key: string): string | null {
  try {
    return area(storage).getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Area, key: string, value: string): boolean {
  try {
    area(storage).setItem(key, value);
    return true;
  } catch {
    // Private mode or a partitioned iframe: overrides still work for this
    // page view, they just will not persist.
    return false;
  }
}

function safeRemove(storage: Area, key: string): void {
  try {
    area(storage).removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/**
 * Moves one pre-3.2 key to its Default-environment key.
 *
 * Each key is handled on its own, with no "already migrated" flag: the
 * session-only secret lives in each tab's own sessionStorage, so every tab
 * migrates its own copy. A newer value already in place wins, and the old
 * key is removed only once the move has been written.
 */
function moveKey(storage: Area, from: string, to: string): void {
  const value = safeGet(storage, from);
  if (value === null) return;
  if (safeGet(storage, to) !== null || safeSet(storage, to, value)) safeRemove(storage, from);
}

/** Moves the pre-3.2 overrides and secret into the Default environment. */
export function migrateLegacyKeys(): void {
  moveKey('local', LEGACY_OVERRIDES_KEY, overridesKey(DEFAULT_ENVIRONMENT_ID));
  moveKey('session', LEGACY_SECRET_SESSION_KEY, secretSessionKey(DEFAULT_ENVIRONMENT_ID));
  moveKey('local', LEGACY_SECRET_PERSISTED_KEY, secretPersistedKey(DEFAULT_ENVIRONMENT_ID));
}

/** Reads and re-validates an environment's stored overrides through the field parsers. */
export function loadOverrides(envId: string): { layer: ConfigLayer; secretIsPersisted: boolean } {
  const values = new Map<string, unknown>();

  const stored = safeGet('local', overridesKey(envId));
  if (stored) {
    try {
      const raw: unknown = JSON.parse(stored);
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          const spec = FIELDS_BY_KEY.get(key as keyof AppConfig);
          if (!spec || spec.kind === 'secret') continue;
          const parsed = spec.parse(value);
          if (parsed.ok) values.set(key, parsed.value);
        }
      }
    } catch {
      // Corrupt overrides should never brick the app; drop them and carry on
      // with the environment's own values.
      safeRemove('local', overridesKey(envId));
    }
  }

  // The secret comes from its own slot, session first.
  const persisted = safeGet('local', secretPersistedKey(envId));
  const sessionSecret = safeGet('session', secretSessionKey(envId));
  const secret = sessionSecret ?? persisted;
  if (secret !== null) values.set('clientSecret', secret);

  return {
    layer: Object.fromEntries(values) as ConfigLayer,
    secretIsPersisted: persisted !== null
  };
}

/** Writes an environment's non-secret overrides. The secret is handled separately. */
export function saveOverrides(envId: string, layer: ConfigLayer): void {
  const toStore = Object.fromEntries(
    Object.entries(layer).filter(([key, value]) => {
      if (value === undefined) return false;
      const spec = FIELDS_BY_KEY.get(key as keyof AppConfig);
      return spec !== undefined && spec.kind !== 'secret';
    })
  );

  if (Object.keys(toStore).length === 0) {
    safeRemove('local', overridesKey(envId));
    return;
  }
  safeSet('local', overridesKey(envId), JSON.stringify(toStore));
}

/**
 * Stores an environment's client secret. `persist: true` is the explicit
 * "remember on this browser" opt-in and moves it to localStorage.
 */
export function saveSecret(envId: string, secret: string, persist: boolean): void {
  if (secret === '') {
    clearSecret(envId);
    return;
  }
  if (persist) {
    safeSet('local', secretPersistedKey(envId), secret);
    safeRemove('session', secretSessionKey(envId));
  } else {
    safeSet('session', secretSessionKey(envId), secret);
    safeRemove('local', secretPersistedKey(envId));
  }
}

export function clearSecret(envId: string): void {
  safeRemove('session', secretSessionKey(envId));
  safeRemove('local', secretPersistedKey(envId));
}

export function clearAllOverrides(envId: string): void {
  safeRemove('local', overridesKey(envId));
  clearSecret(envId);
}

/** This tab's environment, else the one last chosen in any tab. */
export function loadActiveEnvironmentId(): string | null {
  for (const [storage, key] of [
    ['session', ACTIVE_ENVIRONMENT_KEY],
    ['local', LAST_ACTIVE_ENVIRONMENT_KEY]
  ] as const) {
    const value = safeGet(storage, key);
    if (isEnvironmentId(value)) return value;
  }
  return null;
}

export function saveActiveEnvironmentId(envId: string): void {
  safeSet('session', ACTIVE_ENVIRONMENT_KEY, envId);
  safeSet('local', LAST_ACTIVE_ENVIRONMENT_KEY, envId);
}

export interface StoredEnvironmentEntry {
  id: string;
  name: string;
}

/**
 * The environments made in this browser. What comes back is input: an entry
 * with a malformed id, a reserved id or no usable name is skipped, a repeated
 * id keeps its first entry, and the list is capped.
 */
export function loadEnvironmentIndex(): StoredEnvironmentEntry[] {
  const stored = safeGet('local', ENVIRONMENT_INDEX_KEY);
  if (!stored) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const entries = new Map<string, StoredEnvironmentEntry>();
  for (const item of raw) {
    if (entries.size >= MAX_ENVIRONMENTS) break;
    if (!item || typeof item !== 'object') continue;
    const { id, name } = item as { id?: unknown; name?: unknown };
    if (!isEnvironmentId(id) || id === DEFAULT_ENVIRONMENT_ID || id.startsWith('deploy:')) continue;
    const clean = sanitizeName(name);
    if (!clean || entries.has(id)) continue;
    entries.set(id, { id, name: clean });
  }
  return [...entries.values()];
}

export function saveEnvironmentIndex(entries: StoredEnvironmentEntry[]): void {
  if (entries.length === 0) {
    safeRemove('local', ENVIRONMENT_INDEX_KEY);
    return;
  }
  safeSet(
    'local',
    ENVIRONMENT_INDEX_KEY,
    JSON.stringify(entries.map(({ id, name }) => ({ id, name })))
  );
}
