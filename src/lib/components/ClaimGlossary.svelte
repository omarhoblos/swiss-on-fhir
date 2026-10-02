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
  import {
    CUSTOM_CLAIM_MESSAGE,
    claimGroups,
    describeClaim,
    matchesClaim,
    type ClaimKind
  } from '$lib/oidc/claims';

  /**
   * The glossary: one entry's definition when `entry` is set, and a
   * searchable list of every claim and header parameter a specification
   * defines.
   *
   * A native <dialog> opened with showModal(), which supplies the backdrop,
   * the top layer, Escape to close and returning focus afterwards, and works
   * on a phone where hover text cannot be read at all.
   *
   * Only the list scrolls. The title, the chosen entry's definition and the
   * search box stay put above it, so picking an entry far down the list shows
   * its definition without losing the place, and the search box is always in
   * reach.
   */
  let {
    open = $bindable(false),
    entry = $bindable(null)
  }: { open?: boolean; entry?: { name: string; kind: ClaimKind } | null } = $props();

  let dialog = $state<HTMLDialogElement>();
  let list = $state<HTMLElement>();
  let search = $state<HTMLInputElement>();
  let heading = $state<HTMLHeadingElement>();
  let query = $state('');

  const KIND_LABEL: Record<ClaimKind, string> = { claim: 'Claim', header: 'Header parameter' };
  // Header first, as in the token panels, which show a token's header above its claims.
  const sections = (['header', 'claim'] as const).map((kind) => ({
    kind,
    title: kind === 'claim' ? 'Claims' : 'Header parameters',
    groups: claimGroups(kind)
  }));

  const selected = $derived(entry === null ? null : describeClaim(entry.name, entry.kind));
  const visibleSections = $derived(
    sections
      .map((section) => ({
        ...section,
        groups: section.groups
          .map((group) => ({
            ...group,
            claims: group.claims.filter((c) => matchesClaim(c, query))
          }))
          .filter((group) => group.claims.length > 0)
      }))
      .filter((section) => section.groups.length > 0)
  );

  // A new search starts at the top of what it found.
  $effect(() => {
    void query;
    list?.scrollTo({ top: 0 });
  });

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Browsing: straight to the search box. An entry: its definition first.
      if (entry === null) search?.focus();
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

  async function show(name: string, kind: ClaimKind, button: HTMLElement) {
    entry = { name, kind };
    await tick();
    // The definition above the list can change height and push the entry
    // just picked out of sight.
    button.scrollIntoView({ block: 'nearest' });
    heading?.focus({ preventScroll: true });
  }
</script>

<dialog
  bind:this={dialog}
  {onclose}
  onclick={onbackdrop}
  aria-labelledby="claim-glossary-heading"
  class="bg-surface text-fg border-border m-auto w-[min(40rem,calc(100vw-2rem))] max-w-none rounded-lg border p-0 backdrop:bg-black/60"
>
  <div class="flex max-h-[85vh] flex-col">
    <header
      class="border-border flex shrink-0 items-start justify-between gap-4 border-b px-4 py-3"
    >
      <div class="min-w-0">
        <h2
          id="claim-glossary-heading"
          bind:this={heading}
          tabindex="-1"
          class="font-semibold break-all outline-none {selected ? 'text-json-key font-mono' : ''}"
        >
          {entry?.name ?? 'Glossary'}
        </h2>
        {#if entry}
          <p class="text-fg-muted mt-0.5 text-xs">{KIND_LABEL[entry.kind]}</p>
        {:else}
          <p class="text-fg-muted mt-0.5 text-xs">
            What the claims and header parameters in a token mean, from the specifications that
            define them.
          </p>
        {/if}
      </div>
      <button
        type="button"
        class="border-border-control text-fg-muted hover:text-fg shrink-0 rounded border px-2 py-1 text-xs"
        onclick={() => dialog?.close()}
      >
        Close
      </button>
    </header>

    {#if selected}
      <!-- Capped, so a long definition cannot squeeze the list out on a short screen. -->
      <section
        class="border-border max-h-[30vh] shrink-0 space-y-2 overflow-y-auto border-b px-4 py-3"
        aria-live="polite"
      >
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

    <div class="border-border shrink-0 border-b px-4 py-3">
      <label for="claim-glossary-search" class="text-fg-muted text-xs font-medium">
        Search claims and header parameters
      </label>
      <input
        id="claim-glossary-search"
        bind:this={search}
        bind:value={query}
        type="search"
        placeholder="Search by name or meaning"
        autocomplete="off"
        class="bg-bg border-border-control mt-1 w-full rounded border px-2 py-1.5 text-sm"
      />
    </div>

    <section
      bind:this={list}
      aria-label="Claims and header parameters"
      class="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-4 py-3"
      data-glossary-list
    >
      {#if visibleSections.length === 0}
        <div class="text-fg-muted space-y-1 text-sm">
          <p>No pre-defined claims or header parameters match &ldquo;{query.trim()}&rdquo;.</p>
          <p class="text-xs">Anything that isn't listed here is shown as: {CUSTOM_CLAIM_MESSAGE}</p>
        </div>
      {:else}
        {#each visibleSections as section (section.kind)}
          <div class="space-y-3" data-kind={section.kind}>
            <h3 class="border-border border-b pb-1 text-sm font-semibold">{section.title}</h3>
            {#each section.groups as group (group.spec)}
              <div>
                <h4 class="text-fg-muted text-xs font-medium">{group.spec}</h4>
                <ul class="mt-1 space-y-1">
                  {#each group.claims as definition (definition.name)}
                    <li class="flex gap-2 text-xs">
                      <button
                        type="button"
                        class="text-json-key hover:text-primary w-36 shrink-0 text-left font-mono break-all hover:underline"
                        aria-current={entry?.name === definition.name && entry.kind === section.kind
                          ? 'true'
                          : undefined}
                        onclick={(event) =>
                          void show(definition.name, section.kind, event.currentTarget)}
                      >
                        {definition.name}
                      </button>
                      <span class="text-fg-muted">{definition.summary}</span>
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
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
