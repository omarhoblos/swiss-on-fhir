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
  import { config } from '#lib/config/config.svelte.ts';
  import { readImportFile } from '#lib/config/import-file.ts';
  import { downloadText, timestampedFilename } from '#lib/download.ts';
  import { parseImportText, type ParsedFile } from '#lib/environments/format.ts';
  import {
    exportEnvironments,
    importEnvironments,
    type ImportOutcome
  } from '#lib/environments/manage.ts';
  import Alert from './ui/Alert.svelte';
  import Card from './ui/Card.svelte';

  /**
   * Export and import, on the Configuration page.
   *
   * An export is always every environment, as an array, even when there is
   * only Default. An import is previewed first: each environment with its
   * problems, whether its name is taken, and whether it carries a Backend
   * Services key. Each one is imported whole or not at all. A file holding a
   * single configuration, as Swiss 3.1 exported, or a `.env`, applies to the
   * environment in use. A .json or .env file can be chosen or dropped onto
   * the box; any other file is refused before it is read.
   */
  let includeSecrets = $state(false);
  let importText = $state('');
  let parsed = $state<ParsedFile | null>(null);
  let chosen = $state<Record<number, boolean>>({});
  let mode = $state<'copy' | 'replace'>('copy');
  let outcome = $state<ImportOutcome | null>(null);
  let singleApplied = $state<{ applied: number; changed: number } | null>(null);
  let busy = $state(false);
  /** Why a chosen or dropped file was refused. */
  let fileError = $state<string | null>(null);
  let dragging = $state(false);

  const anySecret = $derived(
    config.environments.some((env) => Boolean(config.effectiveFor(env.id)?.clientSecret))
  );

  const taken = (name: string) =>
    config.environments.some((env) => env.name.toLowerCase() === name.toLowerCase());

  const importable = $derived(
    parsed?.kind === 'environments'
      ? parsed.environments.filter((env) => env.errors.length === 0 && chosen[env.position])
      : []
  );
  const anyClash = $derived(
    parsed?.kind === 'environments' && parsed.environments.some((env) => taken(env.name))
  );

  async function download() {
    downloadText(
      timestampedFilename('swiss-environments', 'json'),
      await exportEnvironments({ includeSecret: includeSecrets }),
      'application/json'
    );
  }

  function downloadEnv() {
    downloadText(
      timestampedFilename('swiss-config', 'env'),
      config.toDotEnv({ includeSecret: includeSecrets }),
      'text/plain'
    );
  }

  /** A chosen or dropped file: read into the box and previewed, if it is .json or .env. */
  async function loadFiles(files: readonly File[]) {
    const result = await readImportFile(files);
    if (!result.ok) {
      fileError = result.error;
      return;
    }
    fileError = null;
    importText = result.text;
    preview();
  }

  async function readFile(event: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    if (files.length > 0) await loadFiles(files);
  }

  /** Only a dragged file is ours to handle; dragged text drops into the box as usual. */
  function carriesFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') ?? false;
  }

  function onDragOver(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dragging = true;
  }

  async function onDrop(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragging = false;
    await loadFiles([...(event.dataTransfer?.files ?? [])]);
  }

  /**
   * A file dropped anywhere else on the page would make the browser open it
   * in place of Swiss, losing whatever is unsaved here.
   */
  function guardPage(event: DragEvent) {
    if (carriesFiles(event)) event.preventDefault();
  }

  /**
   * Grows the box to show all of its text, wrapped lines included, so a
   * pasted or dropped file shows whole. It measures again when the text or
   * the box's width changes; past its max height the box scrolls.
   */
  function fitContent(box: HTMLTextAreaElement) {
    const fit = () => {
      box.style.height = 'auto';
      box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
    };
    $effect(() => {
      void importText;
      fit();
    });
    let width = box.clientWidth;
    const observer = new ResizeObserver(() => {
      if (box.clientWidth === width) return;
      width = box.clientWidth;
      fit();
    });
    observer.observe(box);
    return () => observer.disconnect();
  }

  function preview() {
    outcome = null;
    singleApplied = null;
    parsed = parseImportText(importText);
    chosen =
      parsed.kind === 'environments'
        ? Object.fromEntries(
            parsed.environments.map((env) => [env.position, env.errors.length === 0])
          )
        : {};
  }

  async function runImport() {
    if (parsed?.kind !== 'environments') return;
    busy = true;
    try {
      outcome = await importEnvironments(importable, { mode });
      parsed = null;
      importText = '';
    } finally {
      busy = false;
    }
  }

  function applySingle() {
    if (parsed?.kind !== 'single' || parsed.errors.length > 0) return;
    singleApplied = config.applyToActive(parsed.layer);
    parsed = null;
    importText = '';
  }
</script>

<svelte:window ondragover={guardPage} ondrop={guardPage} />

<Card title="Export and import">
  {#snippet actions()}
    <button
      type="button"
      class="border-border-control text-fg-muted hover:text-fg rounded-md border px-2 py-1 text-xs"
      onclick={() => config.resetAll()}
      disabled={config.overriddenKeys.length === 0}
    >
      Reset this environment's edits ({config.overriddenKeys.length})
    </button>
  {/snippet}

  <div class="space-y-5">
    <div>
      <p class="text-sm font-medium">Export</p>
      <p class="text-fg-muted mt-0.5 mb-2 text-xs">
        Every environment, {config.environments.length} in all, as one file: their settings, and each
        Backend Services key&rsquo;s public JWKS. Never a private key.
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="bg-primary text-on-primary rounded-md px-2.5 py-1 text-xs font-medium"
          onclick={download}
        >
          Download JSON
        </button>
        <button
          type="button"
          class="border-border-control text-fg-muted hover:text-fg rounded-md border px-2.5 py-1 text-xs"
          onclick={downloadEnv}
          title="A .env describes one server, so this is the environment in use only."
        >
          Download &ldquo;{config.activeEnvironment.name}&rdquo; as .env
        </button>
        <label class="text-fg-muted flex cursor-pointer items-center gap-1.5 text-xs">
          <input type="checkbox" bind:checked={includeSecrets} class="accent-primary h-3.5 w-3.5" />
          Include client secrets
        </label>
      </div>
      {#if includeSecrets && anySecret}
        <p class="text-warning mt-1.5 text-xs">
          The download will contain live client secrets in plaintext.
        </p>
      {/if}
    </div>

    <div>
      <label for="environments-import" class="text-sm font-medium">Import</label>
      <p class="text-fg-muted mt-0.5 mb-1.5 text-xs">
        An environments file, from this page or written by hand, which may carry a Backend Services
        private key. A single configuration, as Swiss 3.1 exported, or a
        <code class="font-mono">.env</code>, applies to &ldquo;{config.activeEnvironment
          .name}&rdquo;. Choose a <code class="font-mono">.json</code> or
        <code class="font-mono">.env</code> file, drop one onto the box, or paste.
      </p>
      <input
        type="file"
        accept=".json,.env,application/json"
        aria-label="Choose an environments file"
        onchange={readFile}
        class="text-fg-muted mb-2 block text-xs"
      />
      <textarea
        id="environments-import"
        bind:value={importText}
        rows="6"
        spellcheck="false"
        placeholder={'{\n  "swissEnvironmentsVersion": 1,\n  "environments": [ … ]\n}\n\nor\n\nISSUER_URI=https://idp.example'}
        class="bg-bg max-h-160 w-full rounded-md border px-2 py-1.5 font-mono text-xs {dragging
          ? 'border-primary outline-primary outline-2'
          : 'border-border-control'}"
        {@attach fitContent}
        ondragover={onDragOver}
        ondragleave={() => (dragging = false)}
        ondrop={onDrop}
        oninput={() => (fileError = null)}></textarea>
      {#if fileError}
        <div class="mt-2">
          <Alert severity="error" title="That file was not loaded">{fileError}</Alert>
        </div>
      {/if}
      <button
        type="button"
        class="border-border-control text-fg-muted hover:text-fg mt-2 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40"
        onclick={preview}
        disabled={importText.trim() === ''}
      >
        Preview
      </button>

      {#if parsed?.kind === 'invalid'}
        <div class="mt-2">
          <Alert severity="error" title="This cannot be imported">{parsed.error}</Alert>
        </div>
      {:else if parsed?.kind === 'single'}
        <div class="border-border mt-3 space-y-2 rounded-md border p-3 text-xs">
          <p>
            A single configuration with {Object.keys(parsed.layer).length} setting(s), for &ldquo;{config
              .activeEnvironment.name}&rdquo;.
          </p>
          {#each parsed.errors as e, i (i)}<p class="text-error">{e}</p>{/each}
          {#each parsed.notes as n, i (i)}<p class="text-fg-muted">{n}</p>{/each}
          <button
            type="button"
            class="bg-primary text-on-primary rounded-md px-2.5 py-1 font-medium disabled:opacity-40"
            disabled={parsed.errors.length > 0}
            onclick={applySingle}
          >
            Apply to {config.activeEnvironment.name}
          </button>
          {#if parsed.errors.length > 0}
            <p class="text-fg-muted">
              Nothing is applied while a setting does not parse, so you never end up with half of
              it.
            </p>
          {/if}
        </div>
      {:else if parsed?.kind === 'environments'}
        <div
          class="border-border mt-3 space-y-3 rounded-md border p-3 text-xs"
          data-testid="import-preview"
        >
          {#each parsed.notes as n, i (i)}<p class="text-fg-muted">{n}</p>{/each}
          <ul class="space-y-2">
            {#each parsed.environments as env (env.position)}
              <li class="space-y-0.5">
                <label class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    bind:checked={chosen[env.position]}
                    disabled={env.errors.length > 0}
                    class="accent-primary h-3.5 w-3.5"
                  />
                  <span class="font-medium">{env.name}</span>
                  {#if taken(env.name)}
                    <span class="text-fg-muted">
                      {mode === 'replace'
                        ? '— replaces the environment of that name'
                        : `— will be named “${config.uniqueName(env.name)}”`}
                    </span>
                  {/if}
                  {#if env.key}
                    <span
                      class="border-border-control text-fg-muted rounded border px-1 text-[10px]"
                    >
                      carries a Backend Services key
                    </span>
                  {/if}
                </label>
                {#each env.errors as e, i (i)}<p class="text-error ml-5">{e}</p>{/each}
                {#each env.notes as n, i (i)}<p class="text-fg-muted ml-5">{n}</p>{/each}
              </li>
            {/each}
          </ul>
          {#if anyClash}
            <fieldset class="flex flex-wrap gap-3">
              <legend class="text-fg-muted mb-1">When a name is already used</legend>
              <label class="flex items-center gap-1.5">
                <input type="radio" bind:group={mode} value="copy" class="accent-primary" />
                Import as a copy
              </label>
              <label class="flex items-center gap-1.5">
                <input type="radio" bind:group={mode} value="replace" class="accent-primary" />
                Replace it
              </label>
            </fieldset>
          {/if}
          <button
            type="button"
            class="bg-primary text-on-primary rounded-md px-2.5 py-1 font-medium disabled:opacity-40"
            disabled={importable.length === 0 || busy}
            onclick={runImport}
          >
            Import {importable.length} environment{importable.length === 1 ? '' : 's'}
          </button>
        </div>
      {/if}

      {#if singleApplied !== null}
        {@const unchanged = singleApplied.applied - singleApplied.changed}
        <!-- Green when something changed; yellow when nothing did, so it does not read as a success. -->
        <div class="mt-2">
          {#if singleApplied.changed > 0}
            <Alert severity="success">
              Applied {singleApplied.changed} setting(s) to &ldquo;{config.activeEnvironment
                .name}&rdquo;.{#if unchanged > 0}
                {unchanged} more already had the value given.{/if}
            </Alert>
          {:else}
            <Alert severity="warning" title="No settings changed">
              {singleApplied.applied > 0
                ? 'Every value in it already matches the one in effect.'
                : 'It has no settings Swiss can apply.'}
            </Alert>
          {/if}
        </div>
      {/if}
      {#if outcome}
        <div class="mt-2 space-y-2" role="status">
          {#if outcome.imported.length > 0}
            <Alert severity="success">
              Imported {outcome.imported
                .map(
                  (i) =>
                    `“${i.name}”${i.replaced ? ' (replaced)' : ''}${i.key ? ' with its key' : ''}`
                )
                .join(', ')}. Switch to one with the picker in the nav.
            </Alert>
          {/if}
          {#each outcome.keyProblems as problem, i (i)}
            <Alert severity="warning" title={`“${problem.name}” was imported without its key`}>
              {problem.error}
            </Alert>
          {/each}
          {#each outcome.refused as refused, i (i)}
            <Alert severity="error" title={`“${refused.name}” was not imported`}>
              {refused.errors.join(' ')}
            </Alert>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</Card>
