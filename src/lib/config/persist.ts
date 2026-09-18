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

import { FIELDS_BY_KEY } from './fields';
import type { AppConfig, ConfigLayer } from './types';

/**
 * Persistence for live in-app config overrides.
 *
 * Overrides go to localStorage so they survive a restart -- that is the point
 * of being able to reconfigure without touching .env. The client secret is
 * the deliberate exception: it goes to sessionStorage and dies with the tab
 * unless the user explicitly opts in, because a secret quietly surviving on
 * disk in a shared browser is the worst outcome here.
 */

export const OVERRIDES_KEY = 'swiss.config.overrides.v1';
export const SECRET_SESSION_KEY = 'swiss.config.secret.session.v1';
export const SECRET_PERSISTED_KEY = 'swiss.config.secret.persisted.v1';

function safeGet(storage: 'local' | 'session', key: string): string | null {
  try {
    const s = storage === 'local' ? localStorage : sessionStorage;
    return s.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: 'local' | 'session', key: string, value: string): void {
  try {
    const s = storage === 'local' ? localStorage : sessionStorage;
    s.setItem(key, value);
  } catch {
    // Private mode or a partitioned iframe: overrides still work for this
    // page view, they just will not persist.
  }
}

function safeRemove(storage: 'local' | 'session', key: string): void {
  try {
    const s = storage === 'local' ? localStorage : sessionStorage;
    s.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/** Reads and re-validates stored overrides through the field parsers. */
export function loadOverrides(): { layer: ConfigLayer; secretIsPersisted: boolean } {
  const layer: ConfigLayer = {};

  const stored = safeGet('local', OVERRIDES_KEY);
  if (stored) {
    try {
      const raw: unknown = JSON.parse(stored);
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          const spec = FIELDS_BY_KEY.get(key as keyof AppConfig);
          if (!spec || spec.kind === 'secret') continue;
          const parsed = spec.parse(value);
          if (parsed.ok) Object.assign(layer, { [key]: parsed.value });
        }
      }
    } catch {
      // Corrupt overrides should never brick the app; drop them and carry on
      // with .env values.
      safeRemove('local', OVERRIDES_KEY);
    }
  }

  // The secret comes from its own slot, session first.
  const persisted = safeGet('local', SECRET_PERSISTED_KEY);
  const sessionSecret = safeGet('session', SECRET_SESSION_KEY);
  const secret = sessionSecret ?? persisted;
  if (secret !== null) layer.clientSecret = secret;

  return { layer, secretIsPersisted: persisted !== null };
}

/** Writes non-secret overrides. The secret is handled separately. */
export function saveOverrides(layer: ConfigLayer): void {
  const toStore: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(layer)) {
    if (value === undefined) continue;
    const spec = FIELDS_BY_KEY.get(key as keyof AppConfig);
    if (!spec || spec.kind === 'secret') continue;
    toStore[key] = value;
  }

  if (Object.keys(toStore).length === 0) {
    safeRemove('local', OVERRIDES_KEY);
    return;
  }
  safeSet('local', OVERRIDES_KEY, JSON.stringify(toStore));
}

/**
 * Stores the client secret. `persist: true` is the explicit "remember on this
 * browser" opt-in and moves it to localStorage.
 */
export function saveSecret(secret: string, persist: boolean): void {
  if (secret === '') {
    clearSecret();
    return;
  }
  if (persist) {
    safeSet('local', SECRET_PERSISTED_KEY, secret);
    safeRemove('session', SECRET_SESSION_KEY);
  } else {
    safeSet('session', SECRET_SESSION_KEY, secret);
    safeRemove('local', SECRET_PERSISTED_KEY);
  }
}

export function clearSecret(): void {
  safeRemove('session', SECRET_SESSION_KEY);
  safeRemove('local', SECRET_PERSISTED_KEY);
}

export function clearAllOverrides(): void {
  safeRemove('local', OVERRIDES_KEY);
  clearSecret();
}
