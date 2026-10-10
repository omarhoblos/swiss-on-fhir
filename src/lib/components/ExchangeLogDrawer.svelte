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
  import { exchangeLog } from '$lib/http/log.svelte';
  import { downloadText } from '$lib/download';
  import { toCurl } from '$lib/http/exchange';
  import CopyButton from './ui/CopyButton.svelte';
  import { canPersistLog } from '$lib/http/log-persist';
  import {
    filterEntries,
    statusCounts,
    statusLabel,
    statusTone,
    type StatusTone
  } from '$lib/http/log-filter';
  import { SvelteSet } from 'svelte/reactivity';
  import UrlLink from './UrlLink.svelte';
  import SessionStatus from './SessionStatus.svelte';
  import MenuButton from './ui/MenuButton.svelte';

  /**
   * A collapsible log of every request Swiss has made, available on every
   * page.
   *
   * This exists because several error messages tell the user to go and look
   * at the raw exchange, and until now there was nowhere to look. It is also
   * the only honest answer to "write events to a log file" in a static
   * browser app: no filesystem access, so the log is kept in memory, the
   * redacted form is persisted so it survives a reload and the OAuth
   * redirect, and it can be downloaded as a file on demand.
   */
  let open = $state(false);
  let includeSecrets = $state(false);

  const entries = $derived(exchangeLog.entries);
  const failureCount = $derived(exchangeLog.failures.length);

  // Narrows the view only; downloads always contain every entry.
  let query = $state('');
  const hiddenStatuses = new SvelteSet<string>();
  const statuses = $derived(statusCounts(entries));
  const visibleEntries = $derived(filterEntries(entries, query, hiddenStatuses));
  const filtering = $derived(query.trim() !== '' || hiddenStatuses.size > 0);

  function toggleStatus(label: string) {
    if (hiddenStatuses.has(label)) hiddenStatuses.delete(label);
    else hiddenStatuses.add(label);
  }

  function showAll() {
    query = '';
    hiddenStatuses.clear();
  }

  function download(kind: 'json' | 'md') {
    const contents =
      kind === 'json'
        ? exchangeLog.export({ includeSecrets })
        : exchangeLog.exportMarkdown({ includeSecrets });
    downloadText(
      exchangeLog.filename(kind),
      contents,
      kind === 'json' ? 'application/json' : 'text/markdown'
    );
  }

  // Whole class names, so Tailwind's scanner finds them.
  const TONE_CLASS: Record<StatusTone, string> = {
    success: 'text-success border-success/40',
    info: 'text-info border-info/40',
    warning: 'text-warning border-warning/40',
    error: 'text-error border-error/40'
  };

  function statusClass(label: string): string {
    return TONE_CLASS[statusTone(label)];
  }
</script>

<!--
  On a phone the three actions do not fit beside the toggle, and wrapping them
  turned a one-line bar into three rows pinned over the page. Below sm they
  move into the opened drawer instead, where there is room.
-->
{#snippet actions(placement: 'up' | 'down')}
  <MenuButton
    label="Download"
    {placement}
    items={[
      { label: 'JSON', onselect: () => download('json') },
      { label: 'Markdown', onselect: () => download('md') }
    ]}
    class="border-border-control text-fg-muted hover:text-fg rounded border px-2 py-0.5 text-[11px]"
  />
  <button
    type="button"
    class="border-border-control text-fg-muted hover:text-fg rounded border px-2 py-0.5 text-[11px]"
    onclick={() => exchangeLog.clear()}
  >
    Clear
  </button>
{/snippet}

<aside
  class="border-border bg-surface fixed inset-x-0 bottom-0 z-40 border-t"
  aria-label="Exchange log"
>
  <div class="mx-auto max-w-6xl px-4">
    <!-- Three columns: the log's toggle, the session status in the middle of
         the bar, the log's actions. The outer two share what is left equally,
         so the status sits at the centre whenever the toggle leaves room. -->
    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2">
      <button
        type="button"
        class="text-fg-muted hover:text-fg flex items-center gap-2 justify-self-start text-xs whitespace-nowrap"
        onclick={() => (open = !open)}
        aria-expanded={open}
      >
        <span class="font-mono">{open ? '∨' : '∧'}</span>
        <span class="font-medium">Exchange log</span>
        <span class="border-border rounded border px-1.5 py-0.5 font-mono text-[10px]">
          {exchangeLog.count}
        </span>
        {#if failureCount > 0}
          <span
            class="border-error/40 text-error rounded border px-1.5 py-0.5 font-mono text-[10px]"
          >
            {failureCount} failed
          </span>
        {/if}
      </button>

      <div class="justify-self-center">
        <SessionStatus />
      </div>

      <div class="flex min-w-0 justify-self-end">
        {#if exchangeLog.count > 0}
          <div class="hidden flex-wrap items-center justify-end gap-2 sm:flex">
            {@render actions('up')}
          </div>
        {/if}
      </div>
    </div>

    {#if open}
      <!-- A scroller clips what is drawn outside its box, which cut the app's
           focus ring (outline plus a 2px offset) off the full-width search box
           and the checkbox at the left edge. -mx-1/px-1 gives the ring room
           without moving the content. -->
      <div class="border-border/60 -mx-1 max-h-[26rem] overflow-auto border-t px-1 py-3">
        {#if exchangeLog.count === 0}
          <p class="text-fg-muted py-4 text-center text-sm">
            No requests yet. Run Diagnostics or send a FHIR query.
          </p>
        {:else}
          <div class="mb-3 flex flex-wrap items-center gap-2 sm:hidden">
            {@render actions('down')}
          </div>
          <div class="mb-3 space-y-1">
            <p class="text-fg-muted text-[11px]">
              Newest first, capped at {exchangeLog.maxEntries} entries.
              {#if exchangeLog.atCapacity}
                <span class="text-warning">Oldest entries are being dropped.</span>
              {/if}
            </p>
            <p class="text-fg-muted text-[11px]">
              {#if exchangeLog.persistError}
                <span class="text-warning">
                  Could not be saved, so the log is kept for this page view only ({exchangeLog.persistError}).
                  Download it before reloading.
                </span>
              {:else if canPersistLog()}
                Survives a reload and the OAuth redirect. <strong
                  >Only the redacted form is stored</strong
                > &mdash; exchanges carry live tokens, so turning redaction off affects this view and
                downloads, never what is written to disk.
              {:else}
                This browser does not allow storage here, so the log is kept for this page view
                only.
              {/if}
            </p>
            <label class="text-fg-muted flex cursor-pointer items-center gap-2 text-[11px]">
              <input type="checkbox" bind:checked={includeSecrets} class="accent-primary h-3 w-3" />
              Include secrets in downloads
              {#if includeSecrets}
                <span class="text-warning">
                  &mdash; the file will contain live tokens in plaintext
                </span>
              {/if}
            </label>
            {#if !config.current.redactSecrets}
              <p class="text-warning text-[11px]">
                Redaction is disabled in Testing options, so this view shows unmasked credentials.
              </p>
            {/if}
          </div>

          <div class="mb-3 space-y-2">
            <input
              type="search"
              bind:value={query}
              aria-label="Search the exchange log"
              placeholder="Search by URL, method, status or what made the request"
              autocomplete="off"
              class="bg-bg border-border-control w-full rounded border px-2 py-1 text-xs"
            />
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-fg-muted text-[11px]" id="exchange-log-statuses">Show:</span>
              <div
                class="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-labelledby="exchange-log-statuses"
              >
                {#each statuses as status (status.label)}
                  {@const shown = !hiddenStatuses.has(status.label)}
                  <button
                    type="button"
                    aria-pressed={shown}
                    title={shown
                      ? `Hide ${status.label} responses`
                      : `Show ${status.label} responses`}
                    onclick={() => toggleStatus(status.label)}
                    class="rounded border px-1.5 py-0.5 font-mono text-[10px] transition-opacity
                      {statusClass(status.label)}
                      {shown ? '' : 'line-through opacity-40'}"
                  >
                    {status.label} <span class="text-fg-muted">&times;{status.count}</span>
                  </button>
                {/each}
              </div>
              {#if filtering}
                <span class="text-fg-muted ml-auto text-[11px]">
                  Showing {visibleEntries.length} of {entries.length}
                </span>
                <button
                  type="button"
                  class="text-primary text-[11px] hover:underline"
                  onclick={showAll}
                >
                  Show all
                </button>
              {/if}
            </div>
          </div>

          {#if visibleEntries.length === 0}
            <p class="text-fg-muted py-4 text-center text-xs">
              No requests match the search or the statuses shown.
            </p>
          {/if}

          {#each visibleEntries as entry (entry.id)}
            <details class="border-border/40 border-b last:border-b-0">
              <summary
                class="hover:bg-surface-2/40 flex flex-wrap items-center gap-2 px-1 py-1.5 font-mono text-[11px]"
              >
                <span class="rounded border px-1.5 py-0.5 {statusClass(statusLabel(entry))}">
                  {statusLabel(entry)}
                </span>
                <span class="text-fg-muted w-14 shrink-0">{entry.request.method}</span>
                <span class="min-w-0 flex-1 truncate">
                  <UrlLink
                    value={entry.request.url}
                    class="hover:text-primary underline decoration-dotted underline-offset-2"
                  />
                </span>
                <span class="text-fg-muted shrink-0">{entry.durationMs}ms</span>
                <CopyButton value={() => toCurl(entry, config.origin ?? '')} label="Copy as curl" />
              </summary>

              <div class="space-y-2 px-1 pb-3 pl-4 text-[11px]">
                <p class="text-fg-muted">{entry.label}</p>

                {#if entry.redactions.length > 0}
                  <p class="text-warning">Redacted: {entry.redactions.join(', ')}</p>
                {/if}

                {#if entry.diagnosis}
                  <div>
                    <p class="font-medium">
                      Likely cause: {entry.diagnosis.likelyCause} ({entry.diagnosis.confidence})
                    </p>
                    <ul class="text-fg-muted mt-0.5 list-outside list-disc space-y-0.5 pl-4">
                      {#each entry.diagnosis.evidence as evidence, i (i)}
                        <li>{evidence}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}

                <div>
                  <p class="text-fg-muted">Request headers</p>
                  <pre
                    class="bg-bg border-border mt-0.5 overflow-auto rounded border p-2 font-mono">{Object.entries(
                      entry.request.headers
                    )
                      .map(([k, v]) => `${k}: ${v}`)
                      .join('\n') || '(none)'}</pre>
                </div>

                {#if entry.request.body}
                  <div>
                    <p class="text-fg-muted">Request body</p>
                    <pre
                      class="bg-bg border-border mt-0.5 max-h-40 overflow-auto rounded border p-2 font-mono whitespace-pre-wrap">{entry
                        .request.body}</pre>
                  </div>
                {/if}

                {#if entry.response?.body}
                  <div>
                    <p class="text-fg-muted">Response body</p>
                    <pre
                      class="bg-bg border-border mt-0.5 max-h-60 overflow-auto rounded border p-2 font-mono whitespace-pre-wrap">{entry
                        .response.body}</pre>
                  </div>
                {/if}
              </div>
            </details>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</aside>
