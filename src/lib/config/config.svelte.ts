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
  newEnvironmentId,
  sanitizeName,
  type Environment
} from '#lib/environments/types.ts';
import { DEFAULTS } from './defaults';
import { ENV_BACKED_FIELDS, FIELDS, fieldSpec } from './fields';
import { authFingerprint, deriveRedirectUri, mergeDefined, resolveSources } from './merge';
import {
  clearAllOverrides,
  ENVIRONMENT_INDEX_KEY,
  loadActiveEnvironmentId,
  loadEnvironmentIndex,
  loadOverrides,
  migrateLegacyKeys,
  overridesKey,
  saveActiveEnvironmentId,
  saveEnvironmentIndex,
  saveOverrides,
  saveSecret,
  secretPersistedKey
} from './persist';
import type { RuntimeLoadResult } from './runtime';
import type { DeploymentLoadResult } from '#lib/environments/deployment.ts';
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

/** The values of `layer` that differ from `base`, which are what an override needs to hold. */
function differingFrom(base: AppConfig, layer: ConfigLayer): ConfigLayer {
  return Object.fromEntries(
    Object.entries(layer).filter(
      ([key, value]) => value !== undefined && value !== base[key as keyof AppConfig]
    )
  ) as ConfigLayer;
}

function browserEnvironment(entry: { id: string; name: string }): Environment {
  return { id: entry.id, name: entry.name, origin: 'browser', base: {}, baseSource: 'environment' };
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
  #listening = false;
  #deploymentIssues = $state<string[]>([]);
  #deploymentServesKeys = $state(false);
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
  /** Problems with the deployment's environments file, and its keys. */
  readonly deploymentIssues = $derived(this.#deploymentIssues);
  /**
   * What the deployment file hands every visitor in plaintext: it is served
   * to anyone who can reach Swiss, as /swiss-env.json is.
   */
  readonly deploymentServesKeys = $derived(this.#deploymentServesKeys);
  readonly deploymentServesSecrets = $derived(
    this.#environments.some((e) => e.origin === 'deployment' && Boolean(e.base.clientSecret))
  );

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

  /** Called once from the root layout load, after fetching the runtime and deployment files. */
  hydrate(result: RuntimeLoadResult, deployment?: DeploymentLoadResult): void {
    migrateLegacyKeys();
    this.#environments = [
      defaultEnvironment(result.layer),
      ...(deployment?.environments ?? []).map((env): Environment => ({
        id: env.id,
        name: env.name,
        origin: 'deployment',
        base: env.layer,
        baseSource: 'environment'
      })),
      ...loadEnvironmentIndex().map(browserEnvironment)
    ];
    this.#deploymentIssues = deployment?.issues ?? [];
    this.#deploymentServesKeys = (deployment?.environments ?? []).some((e) => e.key);
    this.#runtimeIssues = result.issues;
    this.#loadError = result.loadError;
    this.#frameAncestors = result.frameAncestors;

    // A first visit, with nothing stored, starts where the deployment says.
    const stored = loadActiveEnvironmentId() ?? deployment?.defaultEnvironment ?? null;
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
    this.#listenToOtherTabs();
  }

  /**
   * An edit in another tab to the environment this tab shows applies here
   * too, so two tabs never act on different versions of one environment's
   * settings. A launch in flight is unaffected: it uses its snapshot.
   */
  #listenToOtherTabs(): void {
    if (this.#listening || typeof window === 'undefined') return;
    this.#listening = true;
    window.addEventListener('storage', (event) => {
      if (event.key === null || event.key === ENVIRONMENT_INDEX_KEY) this.#reloadIndex();
      const id = this.#activeId;
      if (
        event.key === null ||
        event.key === overridesKey(id) ||
        event.key === secretPersistedKey(id)
      ) {
        this.#activate(id);
      }
    });
  }

  /**
   * Re-reads the environments made in this browser, after another tab
   * changed them. One deleted there while this tab uses it stays listed here
   * until this tab switches away, with a notice: its settings are gone, but
   * the page should not change environment under the user's hands.
   */
  #reloadIndex(): void {
    const fresh = loadEnvironmentIndex().map(browserEnvironment);
    const builtIn = this.#environments.filter((e) => e.origin !== 'browser');
    const active = this.activeEnvironment;
    const keepActive = active.origin === 'browser' && !fresh.some((e) => e.id === active.id);
    this.#environments = [...builtIn, ...fresh, ...(keepActive ? [active] : [])];
    if (keepActive) {
      this.#environmentNotice = `The environment “${active.name}” was deleted in another tab. Switch to another environment to carry on.`;
    }
  }

  /** The browser-made environments as stored, re-read so another tab's changes are kept. */
  #writeIndex(change: (entries: { id: string; name: string }[]) => { id: string; name: string }[]) {
    const next = change(loadEnvironmentIndex());
    saveEnvironmentIndex(next);
    this.#reloadIndex();
  }

  /** A name not used by another environment, by adding " (2)", " (3)" and so on. */
  uniqueName(wanted: string, exceptId?: string): string {
    const base = sanitizeName(wanted) ?? 'New environment';
    const taken = new Set(
      this.#environments.filter((e) => e.id !== exceptId).map((e) => e.name.toLowerCase())
    );
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n += 1) {
      const suffix = ` (${n})`;
      const candidate = `${[...base].slice(0, 80 - suffix.length).join('')}${suffix}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  /**
   * Makes an environment in this browser and returns its id. `from` copies
   * another environment's effective values (secret included, into the new
   * one's own slot); without it the new environment starts from the built-in
   * defaults.
   */
  createEnvironment(name: string, from?: string): string {
    return this.#addEnvironment(this.uniqueName(name), from ? (this.effectiveFor(from) ?? {}) : {});
  }

  /**
   * Stores a new browser environment. A browser environment has no base, so
   * its values are its overrides: only those that differ from the built-in
   * defaults are kept. A secret goes to its own slot, for this tab only.
   */
  #addEnvironment(name: string, values: ConfigLayer): string {
    const id = newEnvironmentId();
    const { clientSecret, ...rest } = values;
    saveOverrides(id, differingFrom(DEFAULTS, rest));
    if (clientSecret) saveSecret(id, clientSecret, false);
    this.#writeIndex((entries) => [...entries, { id, name }]);
    return id;
  }

  /**
   * Imports one environment from a file. As a copy it is always a new
   * environment, its name made unique. To replace, it overwrites the
   * environment of the same name: for one made here, its settings become
   * the file's; for Default or a deployment environment, the file's values
   * become edits on top of its own.
   */
  importEnvironment(
    name: string,
    layer: ConfigLayer,
    mode: 'copy' | 'replace'
  ): { id: string; name: string; replaced: boolean } {
    const existing =
      mode === 'replace'
        ? this.#environments.find((e) => e.name.toLowerCase() === name.toLowerCase())
        : undefined;
    if (!existing) {
      const finalName = this.uniqueName(name);
      return { id: this.#addEnvironment(finalName, layer), name: finalName, replaced: false };
    }
    const { clientSecret, ...rest } = layer;
    const base = existing.origin === 'browser' ? DEFAULTS : mergeDefined(DEFAULTS, existing.base);
    clearAllOverrides(existing.id);
    saveOverrides(existing.id, differingFrom(base, rest));
    if (clientSecret !== undefined) saveSecret(existing.id, clientSecret, false);
    if (existing.id === this.#activeId) this.#activate(existing.id);
    return { id: existing.id, name: existing.name, replaced: true };
  }

  /** Adds problems found after loading, such as a deployment key that cannot be used. */
  addDeploymentIssues(issues: string[]): void {
    if (issues.length > 0) this.#deploymentIssues = [...this.#deploymentIssues, ...issues];
  }

  /** Drops the edits made in this browser to an environment, back to its own values. */
  resetEnvironment(envId: string): void {
    if (envId === this.#activeId) {
      this.resetAll();
      return;
    }
    clearAllOverrides(envId);
  }

  /** Copies an environment, from the deployment or this browser, into a new one here. */
  duplicateEnvironment(envId: string): string | null {
    const env = this.environmentById(envId);
    if (!env) return null;
    return this.createEnvironment(`${env.name} (copy)`, envId);
  }

  /** Renames an environment made in this browser. */
  renameEnvironment(envId: string, name: string): boolean {
    const env = this.environmentById(envId);
    const clean = sanitizeName(name);
    if (!env || env.origin !== 'browser' || !clean) return false;
    const finalName = this.uniqueName(clean, envId);
    this.#writeIndex((entries) =>
      entries.map((e) => (e.id === envId ? { ...e, name: finalName } : e))
    );
    return true;
  }

  /**
   * Forgets an environment made in this browser and its settings. Low level:
   * call `deleteEnvironment` (src/lib/environments/manage.ts), which also
   * switches away from it and removes its sessions, key and saved headers.
   */
  removeEnvironment(envId: string): boolean {
    const env = this.environmentById(envId);
    if (!env || env.origin !== 'browser' || envId === this.#activeId) return false;
    clearAllOverrides(envId);
    this.#writeIndex((entries) => entries.filter((e) => e.id !== envId));
    this.#environments = this.#environments.filter((e) => e.id !== envId);
    return true;
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
   * Applies one configuration (a 3.1 export, or a settings object) to the
   * environment in use, as edits, so "Reset" still returns to the
   * environment's own values. Returns how many settings it set.
   */
  applyToActive(layer: ConfigLayer): number {
    const { clientSecret, ...rest } = layer;
    const next: ConfigLayer = { ...this.#overrides, ...rest };
    this.#overrides = next;
    saveOverrides(this.#activeId, next);
    if (clientSecret !== undefined) {
      this.#overrides = { ...this.#overrides, clientSecret };
      saveSecret(this.#activeId, clientSecret, this.#secretIsPersisted);
    }
    return Object.keys(layer).length;
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
