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
  import { deleteEnvironment } from '#lib/environments/manage.ts';
  import { switchEnvironment } from '#lib/environments/switch.ts';
  import { MAX_ENVIRONMENT_NAME_LENGTH, type Environment } from '#lib/environments/types.ts';
  import Card from './ui/Card.svelte';

  /**
   * The environments Swiss knows, on the Configuration page: switch, make,
   * copy, rename and delete. Default comes from .env and cannot be renamed
   * or deleted; nor can one shipped with the deployment, though either can
   * be copied into one made here.
   */
  let creating = $state(false);
  let newName = $state('');
  let copyActive = $state(false);
  let renamingId = $state<string | null>(null);
  let renameDraft = $state('');
  let confirmingDelete = $state<string | null>(null);
  let message = $state<string | null>(null);

  const ORIGIN_LABELS: Record<Environment['origin'], string> = {
    builtin: 'from .env',
    deployment: 'from the deployment file',
    browser: 'this browser'
  };

  function create() {
    const id = config.createEnvironment(
      newName.trim() || 'New environment',
      copyActive ? config.activeEnvironmentId : undefined
    );
    switchEnvironment(id);
    message = `Made and switched to “${config.activeEnvironment.name}”. Its settings are below.`;
    creating = false;
    newName = '';
    copyActive = false;
  }

  function duplicate(env: Environment) {
    const id = config.duplicateEnvironment(env.id);
    if (!id) return;
    message = `Copied “${env.name}” to “${config.environmentById(id)?.name}”. The client secret was copied for this tab only; sessions and keys were not copied.`;
  }

  function startRename(env: Environment) {
    renamingId = env.id;
    renameDraft = env.name;
  }

  function saveRename() {
    if (renamingId) config.renameEnvironment(renamingId, renameDraft);
    renamingId = null;
  }

  async function remove(env: Environment) {
    confirmingDelete = null;
    if (await deleteEnvironment(env.id)) message = `Deleted “${env.name}”.`;
  }

  function focusAndSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<div id="environments" class="scroll-mt-24">
  <Card
    title="Environments"
    subtitle="Each environment is a complete setup: its server, clients, secret, scopes and options, with its own sessions. The one this tab uses is edited below."
  >
    {#snippet actions()}
      <button
        type="button"
        class="border-border-control text-fg-muted hover:text-fg rounded border px-2 py-1 text-xs"
        onclick={() => (creating = !creating)}
        aria-expanded={creating}
      >
        New environment
      </button>
    {/snippet}

    {#if creating}
      <form
        class="border-border mb-3 space-y-2 rounded-md border p-3"
        onsubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label class="block text-sm font-medium" for="new-environment-name">Name</label>
        <input
          id="new-environment-name"
          type="text"
          bind:value={newName}
          maxlength={MAX_ENVIRONMENT_NAME_LENGTH}
          placeholder="Staging"
          autocomplete="off"
          class="border-border-control bg-bg w-full rounded-md border px-2 py-1.5 text-sm"
          use:focusAndSelect
        />
        <label class="text-fg-muted flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" bind:checked={copyActive} class="accent-primary h-3.5 w-3.5" />
          Start from a copy of &ldquo;{config.activeEnvironment.name}&rdquo; instead of the built-in
          defaults
        </label>
        <div class="flex gap-2">
          <button
            type="submit"
            class="bg-primary text-on-primary rounded-md px-3 py-1.5 text-sm font-medium"
          >
            Create and switch
          </button>
          <button
            type="button"
            class="border-border-control text-fg-muted rounded-md border px-3 py-1.5 text-sm"
            onclick={() => (creating = false)}
          >
            Cancel
          </button>
        </div>
      </form>
    {/if}

    {#if message}
      <p class="text-fg-muted mb-2 text-xs" role="status">{message}</p>
    {/if}

    <ul class="divide-border divide-y">
      {#each config.environments as env (env.id)}
        {@const active = env.id === config.activeEnvironmentId}
        <li class="flex flex-wrap items-center gap-2 py-2 text-sm" data-environment-row={env.id}>
          {#if renamingId === env.id}
            <input
              type="text"
              bind:value={renameDraft}
              maxlength={MAX_ENVIRONMENT_NAME_LENGTH}
              aria-label="New name"
              class="border-border-control bg-bg min-w-0 flex-1 rounded border px-2 py-1 text-sm"
              use:focusAndSelect
              onkeydown={(event) => {
                if (event.key === 'Enter') saveRename();
                else if (event.key === 'Escape') renamingId = null;
              }}
              onblur={saveRename}
            />
          {:else}
            <span class="min-w-0 truncate {active ? 'font-medium' : ''}">{env.name}</span>
            <span class="border-border-control text-fg-muted rounded border px-1.5 text-[10px]">
              {ORIGIN_LABELS[env.origin]}
            </span>
            {#if active}
              <span class="border-primary text-primary rounded border px-1.5 text-[10px]">
                active in this tab
              </span>
            {/if}
          {/if}

          <span class="ml-auto flex flex-wrap gap-3 text-xs">
            {#if !active}
              <button
                type="button"
                class="text-primary hover:underline"
                onclick={() => switchEnvironment(env.id)}
              >
                Switch
              </button>
            {/if}
            {#if env.origin === 'browser' && renamingId !== env.id}
              <button
                type="button"
                class="text-primary hover:underline"
                onclick={() => startRename(env)}
              >
                Rename
              </button>
            {/if}
            <button
              type="button"
              class="text-primary hover:underline"
              onclick={() => duplicate(env)}
            >
              Duplicate
            </button>
            {#if env.origin === 'browser'}
              <button
                type="button"
                class="text-error hover:underline"
                onclick={() => (confirmingDelete = env.id)}
              >
                Delete
              </button>
            {/if}
          </span>

          {#if confirmingDelete === env.id}
            <div class="border-error/40 w-full rounded-md border p-2 text-xs" role="alert">
              <p>
                Delete &ldquo;{env.name}&rdquo;? Its settings, client secret, sessions, Backend
                Services key and saved headers are removed from this browser. Its tokens are
                discarded here, not revoked at the server.
              </p>
              <div class="mt-2 flex gap-2">
                <button
                  type="button"
                  class="border-error text-error rounded border px-2 py-1"
                  onclick={() => remove(env)}
                >
                  Delete it
                </button>
                <button
                  type="button"
                  class="border-border-control text-fg-muted rounded border px-2 py-1"
                  onclick={() => (confirmingDelete = null)}
                >
                  Keep it
                </button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </Card>
</div>
