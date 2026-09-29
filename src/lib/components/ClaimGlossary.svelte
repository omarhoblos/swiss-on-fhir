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
  import { tick } from 'svelte';
  import { CUSTOM_CLAIM_MESSAGE, claimGroups, describeClaim, matchesClaim } from '$lib/oidc/claims';

  /**
   * The claims glossary: one claim's definition when `claim` is set, and a
   * searchable list of every claim a specification defines.
   *
   * A native <dialog> opened with showModal(), which supplies the backdrop,
   * the top layer, Escape to close and returning focus afterwards, and works
   * on a phone where hover text cannot be read at all.
   */
  let {
    open = $bindable(false),
    claim = $bindable(null)
  }: { open?: boolean; claim?: string | null } = $props();

  let dialog = $state<HTMLDialogElement>();
  let body = $state<HTMLDivElement>();
  let search = $state<HTMLInputElement>();
  let heading = $state<HTMLHeadingElement>();
  let query = $state('');

  const groups = claimGroups();
  const selected = $derived(claim === null ? null : describeClaim(claim));
  const visibleGroups = $derived(
    groups
      .map((group) => ({ ...group, claims: group.claims.filter((c) => matchesClaim(c, query)) }))
      .filter((group) => group.claims.length > 0)
  );

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Browsing: straight to the search box. A claim: its definition first.
      if (claim === null) search?.focus();
      else heading?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  function onclose() {
    open = false;
    // Always reopens on the full list.
    query = '';
  }

  // The dialog has no padding of its own, so a click whose target is the
  // dialog itself landed on the backdrop.
  function onbackdrop(event: MouseEvent) {
    if (event.target === dialog) dialog?.close();
  }

  async function show(name: string) {
    claim = name;
    await tick();
    body?.scrollTo({ top: 0 });
    heading?.focus();
  }
</script>

<dialog
  bind:this={dialog}
  {onclose}
  onclick={onbackdrop}
  aria-labelledby="claim-glossary-heading"
  class="bg-surface text-fg border-border m-auto w-[min(40rem,calc(100vw-2rem))] max-w-none rounded-lg border p-0 backdrop:bg-black/60"
>
  <div bind:this={body} class="max-h-[85vh] overflow-auto">
    <header
      class="bg-surface border-border sticky top-0 flex items-start justify-between gap-4 border-b px-4 py-3"
    >
      <div class="min-w-0">
        <h2
          id="claim-glossary-heading"
          bind:this={heading}
          tabindex="-1"
          class="font-semibold break-all outline-none {selected ? 'text-json-key font-mono' : ''}"
        >
          {claim ?? 'Claims glossary'}
        </h2>
        {#if !selected}
          <p class="text-fg-muted mt-0.5 text-xs">
            What the claims in a token mean, from the specifications that define them.
          </p>
        {/if}
      </div>
      <button
        type="button"
        class="border-border text-fg-muted hover:text-fg shrink-0 rounded border px-2 py-1 text-xs"
        onclick={() => dialog?.close()}
      >
        Close
      </button>
    </header>

    {#if selected}
      <section class="border-border space-y-2 border-b px-4 py-3" aria-live="polite">
        {#if selected.known}
          <p class="text-sm">{selected.definition.summary}</p>
          {#if selected.definition.detail}
            <p class="text-fg-muted text-sm">{selected.definition.detail}</p>
          {/if}
          <a
            href={selected.definition.source.url}
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary inline-block text-xs hover:underline"
          >
            {selected.definition.source.spec}, {selected.definition.source.section}
          </a>
        {:else}
          <p class="text-sm">{selected.text}</p>
          <p class="text-fg-muted text-xs">
            Its meaning is whatever your server gives it; check your server's documentation.
          </p>
        {/if}
      </section>
    {/if}

    <section class="space-y-3 px-4 py-3">
      <div>
        <label for="claim-glossary-search" class="text-fg-muted text-xs font-medium">
          Search claims
        </label>
        <input
          id="claim-glossary-search"
          bind:this={search}
          bind:value={query}
          type="search"
          placeholder="Search by name or meaning"
          autocomplete="off"
          class="bg-bg border-border mt-1 w-full rounded border px-2 py-1.5 text-sm"
        />
      </div>

      {#if visibleGroups.length === 0}
        <div class="text-fg-muted space-y-1 text-sm">
          <p>No pre-defined claims match &ldquo;{query.trim()}&rdquo;.</p>
          <p class="text-xs">A claim that isn't listed here is shown as: {CUSTOM_CLAIM_MESSAGE}</p>
        </div>
      {:else}
        {#each visibleGroups as group (group.spec)}
          <div>
            <h3 class="text-fg-muted text-xs font-medium">{group.spec}</h3>
            <ul class="mt-1 space-y-1">
              {#each group.claims as definition (definition.name)}
                <li class="flex gap-2 text-xs">
                  <button
                    type="button"
                    class="text-json-key hover:text-primary w-36 shrink-0 text-left font-mono break-all hover:underline"
                    aria-current={definition.name === claim ? 'true' : undefined}
                    onclick={() => void show(definition.name)}
                  >
                    {definition.name}
                  </button>
                  <span class="text-fg-muted">{definition.summary}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
    </section>
  </div>
</dialog>

<style>
  /* The heading takes focus so the definition is read first, but it is not a
     control, so the app-wide focus ring would only look like a stray box. */
  h2:focus-visible {
    outline: none;
  }
</style>
