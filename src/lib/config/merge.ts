import { AUTH_CRITICAL_KEYS } from './fields';
import type { AppConfig, ConfigLayer, ConfigSource } from './types';

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
export function authFingerprint(config: AppConfig): string {
  const parts = AUTH_CRITICAL_KEYS.map((key) => {
    const value = config[key];
    if (key === 'clientSecret') return `clientSecret:${value ? 'set' : 'unset'}`;
    return `${key}:${String(value)}`;
  });
  return parts.join('|');
}

/** True when two configs would produce interchangeable tokens. */
export function configEquivalentForAuth(a: AppConfig, b: AppConfig): boolean {
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
