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
  import {
    BULK_JOB_STATE_LABEL,
    lastCallAt,
    matchesBulkJob,
    type BulkCallKind,
    type BulkJob
  } from '#lib/fhir/bulk-jobs.ts';
  import { formatAbsolute } from '#lib/time.ts';
  import CopyButton from './ui/CopyButton.svelte';

  /**
   * The status URLs this tab has seen for the environment, newest first, as a
   * native <dialog> like the claims glossary: backdrop, Escape to close and
   * focus returned afterwards. Only the list scrolls.
   */
  let {
    open = $bindable(false),
    jobs,
    onuse,
    onremove,
    onclear
  }: {
    open?: boolean;
    jobs: BulkJob[];
    onuse: (job: BulkJob) => void;
    onremove: (statusUrl: string) => void;
    onclear: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let search = $state<HTMLInputElement>();
  let query = $state('');

  const shown = $derived(jobs.filter((job) => matchesBulkJob(job, query)));

  const CALL_LABEL: Record<BulkCallKind, string> = {
    kickoff: 'Kick-off',
    poll: 'Poll',
    cancel: 'Cancel'
  };

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      search?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  function onclose() {
    open = false;
    query = '';
  }

  // The dialog has no padding of its own, so a click on the dialog itself landed on the backdrop.
  function onbackdrop(event: MouseEvent) {
    if (event.target === dialog) dialog?.close();
  }

  function use(job: BulkJob) {
    onuse(job);
    dialog?.close();
  }

  function plural(n: number, one: string): string {
    return `${n} ${n === 1 ? one : `${one}s`}`;
  }
</script>

<dialog
  bind:this={dialog}
  {onclose}
  onclick={onbackdrop}
  aria-labelledby="bulk-jobs-heading"
  class="bg-surface text-fg border-border m-auto w-[min(44rem,calc(100vw-2rem))] max-w-none rounded-lg border p-0 backdrop:bg-black/60"
>
  <div class="flex max-h-[85vh] flex-col">
    <header
      class="border-border flex shrink-0 items-start justify-between gap-4 border-b px-4 py-3"
    >
      <div class="min-w-0">
        <h2 id="bulk-jobs-heading" class="font-semibold">Known status URLs</h2>
        <p class="text-fg-muted mt-0.5 text-xs">
          Status URLs this tab started or polled on this environment, newest first. Kept until the
          tab closes; each request is also in the exchange log.
        </p>
      </div>
      <button
        type="button"
        class="border-border-control text-fg-muted hover:text-fg shrink-0 rounded border px-2 py-1 text-xs"
        onclick={() => dialog?.close()}
      >
        Close
      </button>
    </header>

    <div class="border-border flex shrink-0 items-end gap-2 border-b px-4 py-3">
      <label class="min-w-0 flex-1">
        <span class="text-fg-muted text-xs font-medium">Search status URLs</span>
        <input
          bind:this={search}
          bind:value={query}
          type="search"
          placeholder="URL, state or status"
          autocomplete="off"
          class="bg-bg border-border-control mt-1 w-full rounded border px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="button"
        class="border-border-control text-fg-muted hover:text-error shrink-0 rounded border px-2 py-1.5 text-xs disabled:opacity-40"
        disabled={jobs.length === 0}
        onclick={onclear}
      >
        Forget all
      </button>
    </div>

    <ul
      aria-label="Known status URLs"
      class="min-h-0 space-y-2 overflow-y-auto overscroll-contain px-4 py-3"
      data-testid="bulk-jobs"
    >
      {#each shown as job (job.statusUrl)}
        {@const last = job.calls.at(-1)}
        <li class="border-border space-y-1.5 rounded-md border px-3 py-2 text-xs">
          <p class="font-mono break-all">{job.statusUrl}</p>
          <p class="text-fg-muted">
            <span class="text-fg font-medium">{BULK_JOB_STATE_LABEL[job.state]}</span>
            {#if last}
              &middot; last {CALL_LABEL[last.kind].toLowerCase()}
              {last.status ?? 'no answer'}, {formatAbsolute(new Date(lastCallAt(job)))}
            {/if}
            &middot; {plural(job.calls.length, 'call')}
          </p>
          {#if job.kickoffUrl}
            <p class="text-fg-muted font-mono break-all">from GET {job.kickoffUrl}</p>
          {/if}
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="bg-primary text-on-primary rounded px-2 py-1 font-medium"
              onclick={() => use(job)}
            >
              Use
            </button>
            <CopyButton value={job.statusUrl} label="Copy URL" />
            <button
              type="button"
              class="border-border-control text-fg-muted hover:text-error rounded border px-2 py-1"
              onclick={() => onremove(job.statusUrl)}
            >
              Forget
            </button>
          </div>
          <details>
            <summary class="text-fg-muted cursor-pointer">Calls</summary>
            <ol class="mt-1 space-y-0.5 font-mono text-[11px]">
              {#each job.calls as call, i (i)}
                <li>
                  {formatAbsolute(new Date(call.at))} &middot; {CALL_LABEL[call.kind]} &middot;
                  {call.status ?? 'no answer'}
                </li>
              {/each}
            </ol>
          </details>
        </li>
      {:else}
        <li class="text-fg-muted text-sm">
          {jobs.length === 0
            ? 'None yet. A kick-off or poll adds its status URL here.'
            : `No status URL matches “${query.trim()}”.`}
        </li>
      {/each}
    </ul>
  </div>
</dialog>
