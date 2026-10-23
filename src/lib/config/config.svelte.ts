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

import {
  DEFAULT_ENVIRONMENT_ID,
  DEFAULT_ENVIRONMENT_NAME,
  type Environment
} from '#lib/environments/types.ts';
import { DEFAULTS } from './defaults';
import { ENV_BACKED_FIELDS, FIELDS, FIELDS_BY_KEY, fieldSpec } from './fields';
import { authFingerprint, deriveRedirectUri, mergeDefined, resolveSources } from './merge';
import {
  clearAllOverrides,
  loadActiveEnvironmentId,
  loadOverrides,
  migrateLegacyKeys,
  saveActiveEnvironmentId,
  saveOverrides,
  saveSecret
} from './persist';
import type { RuntimeLoadResult } from './runtime';
import { validateConfig } from './validate';
import type { AppConfig, ConfigIssue, ConfigLayer, ConfigSource } from './types';

/**
 * The configuration store.
 *
 * Four layers collapse into one `current`, for the environment active in
 * this tab:
 *
 *   DEFAULTS            baked, safe localhost values
 *     -> base           the environment's own values: for the built-in
 *                       Default environment, static/swiss-env.json <- .env,
 *                       rendered by the entrypoint (or render-config.mjs)
 *     -> overrides      live in-app edits to that environment, persisted to
 *                       localStorage under its id
 *     -> launch         ephemeral EHR-launch `iss`, NEVER persisted
 *
 * The launch layer sits on top because in an EHR launch the `iss` the EHR
 * hands us is definitionally correct, and it is deliberately not persisted so
 * one EHR launch cannot quietly rewrite the user's saved configuration.
 *
 * Shape note: this is a class with getters rather than exported `let`
 * bindings because Svelte 5 does not allow exporting reassignable `$state`.
 * The `.svelte.ts` extension is required for runes in a non-component file.
 */

export interface LaunchOverride {
  fhirBaseUrl: string;
  /** What the user had configured, so we can say what was not used. */
  overriddenFhirBaseUrl?: string;
}

function defaultEnvironment(runtime: ConfigLayer): Environment {
  return {
    id: DEFAULT_ENVIRONMENT_ID,
    name: DEFAULT_ENVIRONMENT_NAME,
    origin: 'builtin',
    base: runtime,
    baseSource: 'runtime'
  };
}

class ConfigStore {
  #environments = $state<Environment[]>([defaultEnvironment({})]);
  #activeId = $state(DEFAULT_ENVIRONMENT_ID);
  /** The active environment's overrides. Others are read from storage when asked for. */
  #overrides = $state<ConfigLayer>({});
  #environmentNotice = $state<string | null>(null);
  #launch = $state<ConfigLayer>({});
  #launchInfo = $state<LaunchOverride | null>(null);
  #runtimeIssues = $state<ConfigIssue[]>([]);
  #loadError = $state<string | null>(null);
  #frameAncestors = $state<string[] | null | undefined>(undefined);
  #hydrated = $state(false);
  #secretIsPersisted = $state(false);

  readonly environments = $derived(this.#environments);
  readonly activeEnvironmentId = $derived(this.#activeId);
  // Default is always in the list; the last fallback only satisfies the type.
  readonly activeEnvironment: Environment = $derived(
    this.#environments.find((e) => e.id === this.#activeId) ??
      this.#environments.find((e) => e.id === DEFAULT_ENVIRONMENT_ID) ??
      defaultEnvironment({})
  );
  /** Set when this tab's stored environment no longer exists and Default was used instead. */
  readonly environmentNotice = $derived(this.#environmentNotice);

  /** The active environment's values plus defaults, without live edits. `resetAll` target. */
  readonly base = $derived(mergeDefined(DEFAULTS, this.activeEnvironment.base));

  /** The effective configuration everything else consumes. */
  readonly current = $derived(mergeDefined(mergeDefined(this.base, this.#overrides), this.#launch));

  readonly sources = $derived(
    resolveSources(
      this.activeEnvironment.base,
      this.activeEnvironment.baseSource,
      this.#overrides,
      this.#launch
    )
  );

  readonly overriddenKeys = $derived(
    FIELDS.map((f) => f.key).filter((k) => this.#overrides[k] !== undefined)
  );

  readonly fingerprint = $derived(authFingerprint(this.current));

  readonly loadError = $derived(this.#loadError);
  /** Who may frame Swiss, as the server says; see RuntimeLoadResult. Read-only. */
  readonly frameAncestors = $derived(this.#frameAncestors);
  readonly hydrated = $derived(this.#hydrated);
  readonly launchInfo = $derived(this.#launchInfo);
  readonly secretIsPersisted = $derived(this.#secretIsPersisted);

  readonly origin = $derived(typeof location === 'undefined' ? null : location.origin);

  /** The redirect URI to register. Derived, not configurable. */
  readonly redirectUri = $derived(this.origin ? deriveRedirectUri(this.origin) : '');

  /** Runtime-file issues plus cross-field validation of the effective config. */
  readonly issues = $derived<ConfigIssue[]>([
    ...this.#runtimeIssues,
    ...validateConfig(this.current, this.origin)
  ]);

  readonly errors = $derived(this.issues.filter((i) => i.severity === 'error'));
  readonly warnings = $derived(this.issues.filter((i) => i.severity === 'warning'));

  /** Notes about keys we recognised but ignored (the four removed in 3.0). */
  readonly ignoredKeys = $derived(this.#runtimeIssues.filter((i) => i.ignoredKey));

  /** Called once from the root layout load, after fetching the runtime file. */
  hydrate(result: RuntimeLoadResult): void {
    migrateLegacyKeys();
    this.#environments = [defaultEnvironment(result.layer)];
    this.#runtimeIssues = result.issues;
    this.#loadError = result.loadError;
    this.#frameAncestors = result.frameAncestors;

    const stored = loadActiveEnvironmentId();
    if (stored && this.hasEnvironment(stored)) {
      this.#activate(stored);
    } else {
      this.#activate(DEFAULT_ENVIRONMENT_ID);
      // Never silently: the user picked that environment, and its settings,
      // session and secret are kept in case it comes back.
      if (stored && stored !== DEFAULT_ENVIRONMENT_ID) {
        this.#environmentNotice = `The environment this tab was using (\`${stored}\`) is no longer available, so Default is in use. Its stored settings and sessions were kept.`;
      }
    }
    this.#hydrated = true;
  }

  #activate(envId: string): void {
    this.#activeId = envId;
    const { layer, secretIsPersisted } = loadOverrides(envId);
    this.#overrides = layer;
    this.#secretIsPersisted = secretIsPersisted;
  }

  hasEnvironment(envId: string): boolean {
    return this.#environments.some((e) => e.id === envId);
  }

  environmentById(envId: string): Environment | undefined {
    return this.#environments.find((e) => e.id === envId);
  }

  /**
   * Makes another environment active in this tab. Low level: call
   * `switchEnvironment` (src/lib/environments/switch.ts) instead, which also
   * moves the session and diagnostics over. The launch layer is left alone;
   * it belongs to the Launch page.
   */
  setActive(envId: string): boolean {
    if (!this.hasEnvironment(envId)) return false;
    this.#activate(envId);
    saveActiveEnvironmentId(envId);
    this.#environmentNotice = null;
    return true;
  }

  /**
   * An environment's effective configuration without the launch layer, or
   * null for an unknown id. For the active one this is the live state; for
   * another it is read from storage, so it is not reactive.
   */
  effectiveFor(envId: string): AppConfig | null {
    if (envId === this.#activeId) return mergeDefined(this.base, this.#overrides);
    const env = this.environmentById(envId);
    if (!env) return null;
    return mergeDefined(mergeDefined(DEFAULTS, env.base), loadOverrides(envId).layer);
  }

  /** The client secret set for an environment, or null for an unknown id. */
  secretFor(envId: string): string | null {
    return this.effectiveFor(envId)?.clientSecret ?? null;
  }

  sourceOf(key: keyof AppConfig): ConfigSource {
    return this.sources[key] ?? 'default';
  }

  isOverridden(key: keyof AppConfig): boolean {
    return this.#overrides[key] !== undefined;
  }

  /**
   * Where the value would come from if the live override were removed, so a
   * reset control can say what it actually reverts to.
   */
  sourceOfBase(key: keyof AppConfig): 'runtime' | 'environment' | 'default' {
    const env = this.activeEnvironment;
    return env.base[key] !== undefined ? env.baseSource : 'default';
  }

  /** Parses and applies a raw input value for one field. */
  setRaw(key: keyof AppConfig, raw: unknown): { ok: boolean; error?: string } {
    const spec = fieldSpec(key);
    const parsed = spec.parse(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    this.set(key, parsed.value);
    return { ok: true };
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    // Setting a field back to its .env/default value clears the override
    // rather than recording a redundant one, so the source badge stays honest.
    if (value === this.base[key]) {
      this.resetField(key);
      return;
    }
    this.#overrides = { ...this.#overrides, [key]: value };
    if (fieldSpec(key).kind === 'secret') {
      saveSecret(this.#activeId, String(value), this.#secretIsPersisted);
    } else {
      saveOverrides(this.#activeId, this.#overrides);
    }
  }

  /** Moves the secret between sessionStorage and localStorage. */
  setSecretPersistence(persist: boolean): void {
    this.#secretIsPersisted = persist;
    saveSecret(this.#activeId, String(this.current.clientSecret ?? ''), persist);
  }

  resetField(key: keyof AppConfig): void {
    if (this.#overrides[key] === undefined) return;
    const next = { ...this.#overrides };
    delete next[key];
    this.#overrides = next;
    if (fieldSpec(key).kind === 'secret') {
      saveSecret(this.#activeId, '', this.#secretIsPersisted);
    } else {
      saveOverrides(this.#activeId, next);
    }
  }

  resetAll(): void {
    this.#overrides = {};
    clearAllOverrides(this.#activeId);
  }

  /** Ephemeral: applied for this page view only, never persisted. */
  applyLaunchOverride(override: LaunchOverride): void {
    this.#launchInfo = override;
    this.#launch = { fhirBaseUrl: override.fhirBaseUrl };
  }

  clearLaunchOverride(): void {
    this.#launchInfo = null;
    this.#launch = {};
  }

  /**
   * Exports the effective config as JSON. The secret is omitted unless
   * explicitly requested, so an export is safe to paste into an issue.
   */
  export(options: { includeSecret: boolean } = { includeSecret: false }): string {
    const out: Record<string, unknown> = { swissConfigVersion: 1 };
    for (const spec of FIELDS) {
      if (spec.kind === 'secret' && !options.includeSecret) continue;
      out[spec.key] = this.current[spec.key];
    }
    if (!options.includeSecret && this.current.clientSecret) {
      out.clientSecret = '<omitted>';
    }
    return JSON.stringify(out, null, 2);
  }

  /**
   * Imports a previously exported config. Values land in the OVERRIDE layer,
   * so `resetAll` still returns to whatever .env the deployment ships.
   */
  import(json: string): { ok: boolean; errors: string[]; applied: number } {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch (cause) {
      return {
        ok: false,
        applied: 0,
        errors: [`Not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`]
      };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, applied: 0, errors: ['Expected a JSON object.'] };
    }

    const errors: string[] = [];
    const next: ConfigLayer = { ...this.#overrides };
    let applied = 0;

    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key === 'swissConfigVersion') continue;
      if (value === '<omitted>') continue;
      const spec = FIELDS_BY_KEY.get(key as keyof AppConfig);
      if (!spec) {
        errors.push(`"${key}" is not a recognised setting; ignored.`);
        continue;
      }
      const parsed = spec.parse(value);
      if (!parsed.ok) {
        errors.push(`${spec.label}: ${parsed.error}`);
        continue;
      }
      Object.assign(next, { [key]: parsed.value });
      applied += 1;
    }

    // All-or-nothing on coercion failures: a half-applied config is worse
    // than a rejected one, because you cannot tell which half took effect.
    if (errors.some((e) => !e.includes('not a recognised setting'))) {
      return { ok: false, applied: 0, errors };
    }

    this.#overrides = next;
    saveOverrides(this.#activeId, next);
    if (next.clientSecret !== undefined) {
      saveSecret(this.#activeId, String(next.clientSecret), this.#secretIsPersisted);
    }
    return { ok: errors.length === 0, applied, errors };
  }

  /**
   * The `.env` text equivalent of the current effective config. The client
   * secret follows the same choice as the JSON export: left empty unless the
   * user asked for it, so a pasted `.env` does not carry it by accident.
   */
  toDotEnv(options: { includeSecret: boolean } = { includeSecret: false }): string {
    const lines = ENV_BACKED_FIELDS.map((spec) =>
      spec.kind === 'secret' && !options.includeSecret
        ? `${spec.envKey}=`
        : `${spec.envKey}=${String(this.current[spec.key])}`
    );
    return lines.join('\n') + '\n';
  }
}

export const config = new ConfigStore();
