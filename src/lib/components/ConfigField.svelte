<!--
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
-->

<script lang="ts">
  import { config } from '$lib/config/config.svelte';
  import type { FieldSpec } from '$lib/config/fields';
  import SourceBadge from './ui/SourceBadge.svelte';

  let { spec }: { spec: FieldSpec } = $props();

  const value = $derived(config.current[spec.key]);
  const source = $derived(config.sourceOf(spec.key));
  const overridden = $derived(config.isOverridden(spec.key));

  /** Per-field parse error from the last edit, cleared on a good value. */
  let error = $state<string | null>(null);
  let revealSecret = $state(false);

  function commit(raw: unknown) {
    const result = config.setRaw(spec.key, raw);
    error = result.ok ? null : (result.error ?? 'Invalid value');
  }

  const inputId = $derived(`config-${spec.key}`);
</script>

<div class="border-border/60 border-b py-3 last:border-b-0" data-config-field={spec.key}>
  <div class="flex flex-wrap items-baseline gap-2">
    <label for={inputId} class="text-sm font-medium">{spec.label}</label>
    <SourceBadge {source} />
    {#if spec.envKey}
      <code class="text-fg-muted font-mono text-[10px]">{spec.envKey}</code>
    {:else}
      <span class="text-fg-muted text-[10px] italic">in-app only</span>
    {/if}
    {#if spec.authCritical}
      <span
        class="text-fg-muted text-[10px]"
        title="Changing this invalidates an existing session: tokens issued under the old value are no longer the thing being tested."
      >
        &middot; auth-critical
      </span>
    {/if}
    {#if overridden}
      <button
        type="button"
        class="text-primary ml-auto text-xs hover:underline"
        onclick={() => {
          config.resetField(spec.key);
          error = null;
        }}
      >
        Reset to {config.sourceOfBase(spec.key) === 'runtime' ? '.env value' : 'default'}
      </button>
    {/if}
  </div>

  <div class="mt-2">
    {#if spec.kind === 'boolean'}
      <label class="flex cursor-pointer items-center gap-2 text-sm">
        <input
          id={inputId}
          type="checkbox"
          checked={value === true}
          onchange={(e) => commit(e.currentTarget.checked)}
          class="accent-primary h-4 w-4"
        />
        <span class="text-fg-muted">{value ? 'Enabled' : 'Disabled'}</span>
      </label>
    {:else if spec.kind === 'enum'}
      <select
        id={inputId}
        value={String(value)}
        onchange={(e) => commit(e.currentTarget.value)}
        class="border-border bg-bg w-full rounded-md border px-2 py-1.5 text-sm"
      >
        {#each spec.options ?? [] as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
      {#if (spec.options ?? []).find((o) => o.value === String(value))?.help}
        <p class="text-fg-muted mt-1 text-xs">
          {(spec.options ?? []).find((o) => o.value === String(value))?.help}
        </p>
      {/if}
    {:else if spec.kind === 'secret'}
      <div class="flex gap-2">
        <input
          id={inputId}
          type={revealSecret ? 'text' : 'password'}
          value={String(value)}
          autocomplete="off"
          spellcheck="false"
          placeholder="empty = public client (recommended)"
          onchange={(e) => commit(e.currentTarget.value)}
          class="border-border bg-bg w-full rounded-md border px-2 py-1.5 font-mono text-sm"
        />
        <button
          type="button"
          class="border-border text-fg-muted hover:text-fg shrink-0 rounded-md border px-2 text-xs"
          onclick={() => (revealSecret = !revealSecret)}
        >
          {revealSecret ? 'Hide' : 'Reveal'}
        </button>
      </div>
      {#if value}
        <label class="text-fg-muted mt-2 flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={config.secretIsPersisted}
            onchange={(e) => config.setSecretPersistence(e.currentTarget.checked)}
            class="accent-primary h-3.5 w-3.5"
          />
          Remember on this browser
          <span class="italic">
            (otherwise the secret is kept only for this tab and cleared when it closes)
          </span>
        </label>
      {/if}
    {:else if spec.kind === 'scopes'}
      <textarea
        id={inputId}
        value={String(value)}
        rows="2"
        spellcheck="false"
        onchange={(e) => commit(e.currentTarget.value)}
        class="border-border bg-bg w-full rounded-md border px-2 py-1.5 font-mono text-xs"
      ></textarea>
    {:else}
      <input
        id={inputId}
        type="text"
        value={String(value)}
        spellcheck="false"
        onchange={(e) => commit(e.currentTarget.value)}
        class="border-border bg-bg w-full rounded-md border px-2 py-1.5 font-mono text-sm"
      />
    {/if}
  </div>

  {#if error}
    <p class="text-error mt-1.5 text-xs">{error}</p>
  {/if}
  <p class="text-fg-muted mt-1.5 text-xs">{spec.help}</p>
</div>
