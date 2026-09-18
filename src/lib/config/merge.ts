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

import { AUTH_CRITICAL_KEYS } from './fields';
import type { AppConfig, ConfigLayer, ConfigSnapshot, ConfigSource } from './types';

/**
 * Merges a layer over a base, ignoring `undefined` contributions.
 *
 * A raw `{ ...base, ...layer }` is wrong here: each layer is a Partial, and
 * an explicitly-present `undefined` would overwrite a real base value. The
 * unset-vs-empty question is handled earlier, in runtime.ts, using each
 * field's `emptyMeansUnset`.
 */
export function mergeDefined<T extends object>(base: T, layer: Partial<T>): T {
  const out = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    if (value !== undefined) {
      Object.assign(out, { [key]: value });
    }
  }
  return out;
}

/** Which layer supplied the value currently in effect for each field. */
export function resolveSources(
  runtime: ConfigLayer,
  overrides: ConfigLayer,
  launch: ConfigLayer
): Record<keyof AppConfig, ConfigSource> {
  const out = {} as Record<keyof AppConfig, ConfigSource>;
  const keys = new Set<string>([
    ...Object.keys(runtime),
    ...Object.keys(overrides),
    ...Object.keys(launch)
  ]);
  for (const key of keys) {
    const k = key as keyof AppConfig;
    if (launch[k] !== undefined) out[k] = 'launch';
    else if (overrides[k] !== undefined) out[k] = 'override';
    else if (runtime[k] !== undefined) out[k] = 'runtime';
  }
  return out;
}

/**
 * A stable fingerprint over the auth-critical fields, stored alongside a
 * session so we can tell whether the config has moved since the tokens were
 * issued.
 *
 * The client secret contributes only its PRESENCE, never its value: the
 * fingerprint is shown in the UI and included in diagnostics exports, so it
 * must not be a way to leak or confirm a secret. Rotating a secret does not
 * invalidate a session; adding or removing one does.
 *
 * Synchronous and non-cryptographic on purpose -- this is a change detector,
 * not a security boundary, and making it async would force every caller that
 * just wants to compare two configs to become async too.
 */
export function authFingerprint(config: AppConfig | ConfigSnapshot): string {
  const parts = AUTH_CRITICAL_KEYS.map((key) => {
    if (key === 'clientSecret') {
      return `clientSecret:${hasClientSecret(config) ? 'set' : 'unset'}`;
    }
    return `${key}:${String((config as AppConfig)[key])}`;
  });
  return parts.join('|');
}

/** Reads secret presence from either a full config or a snapshot. */
export function hasClientSecret(config: AppConfig | ConfigSnapshot): boolean {
  return 'hasClientSecret' in config
    ? config.hasClientSecret
    : Boolean((config as AppConfig).clientSecret);
}

/**
 * Strips the client secret, keeping only whether one was set.
 *
 * Used wherever the configuration is persisted alongside a flow or session,
 * so the secret lives in exactly one storage slot rather than three.
 */
export function snapshotConfig(config: AppConfig): ConfigSnapshot {
  const { clientSecret, ...rest } = config;
  return { ...rest, hasClientSecret: Boolean(clientSecret) };
}

/** True when two configs would produce interchangeable tokens. */
export function configEquivalentForAuth(
  a: AppConfig | ConfigSnapshot,
  b: AppConfig | ConfigSnapshot
): boolean {
  return authFingerprint(a) === authFingerprint(b);
}

/**
 * The redirect URI is derived, not configured.
 *
 * v2 plumbed a REDIRECT_URI all the way through and then ignored it, using
 * `window.location.origin` instead -- while the README told users to register
 * `<origin>/index.html`. Deriving it removes the disagreement; the callback
 * handler still accepts the historical landing shapes.
 */
export function deriveRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/callback`;
}
