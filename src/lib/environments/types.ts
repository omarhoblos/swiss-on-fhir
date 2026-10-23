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

import type { ConfigLayer } from '#lib/config/types.ts';

/**
 * An environment: one named server setup that Swiss can switch to.
 *
 * The configuration of the active environment is
 *
 *   DEFAULTS -> environment.base -> environment's overrides -> launch layer
 *
 * The built-in Default environment's base is the runtime file rendered from
 * `.env`, so a deployment that never creates another environment behaves
 * exactly as before. A deployment file's environment has its own values as
 * its base, and an environment made in the browser has an empty base, its
 * values living entirely in its overrides.
 */
export interface Environment {
  id: string;
  name: string;
  origin: EnvironmentOrigin;
  /** The layer under the overrides. Never edited in the app. */
  base: ConfigLayer;
  /** Which source badge a value from `base` carries. */
  baseSource: 'runtime' | 'environment';
}

export type EnvironmentOrigin = 'builtin' | 'deployment' | 'browser';

export const DEFAULT_ENVIRONMENT_ID = 'default';
export const DEFAULT_ENVIRONMENT_NAME = 'Default';

/**
 * The three ways Swiss obtains tokens. A session slot is one environment and
 * one of these, so tokens from different flows never replace each other.
 * The values match `LaunchIntent.flavor`.
 */
export const LAUNCH_TYPES = ['standalone', 'ehr', 'backend-services'] as const;
export type LaunchType = (typeof LAUNCH_TYPES)[number];

export function isLaunchType(value: unknown): value is LaunchType {
  return typeof value === 'string' && (LAUNCH_TYPES as readonly string[]).includes(value);
}

/**
 * Ids end up in storage keys, IndexedDB record ids and DOM ids, and are read
 * back from storage and from files, so they are held to a strict shape.
 * A deployment file's ids carry a `deploy:` prefix so they cannot collide
 * with an id made in the browser.
 */
export const ENVIRONMENT_ID_PATTERN = /^(deploy:)?[a-z0-9][a-z0-9-]{0,63}$/;

export function isEnvironmentId(value: unknown): value is string {
  return typeof value === 'string' && ENVIRONMENT_ID_PATTERN.test(value);
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A new random id for an environment made in the browser.
 *
 * `getRandomValues`, not `randomUUID`: the latter exists only in a secure
 * context, and Swiss also runs over plain http on a LAN.
 */
export function newEnvironmentId(): string {
  let suffix = '';
  while (suffix.length < 10) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      // 36 does not divide 256: bytes from 252 up would favour the first
      // four characters, so they are skipped.
      if (byte < 252 && suffix.length < 10) suffix += ID_ALPHABET[byte % ID_ALPHABET.length];
    }
  }
  return `env-${suffix}`;
}

export const MAX_ENVIRONMENT_NAME_LENGTH = 80;

/**
 * Cleans a name for display. Names come from the user, from files and from
 * storage; they are only ever shown as text, but a control character or a
 * page-long name still breaks the layout and the Markdown log export.
 * Returns null for a name that is empty once cleaned.
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return [...cleaned].slice(0, MAX_ENVIRONMENT_NAME_LENGTH).join('');
}
