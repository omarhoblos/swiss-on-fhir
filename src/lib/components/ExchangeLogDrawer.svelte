<script lang="ts">
  import { config } from '$lib/config/config.svelte';
  import { downloadText, exchangeLog } from '$lib/http/log.svelte';
  import { toCurl } from '$lib/http/exchange';
  import { copyToClipboard } from '$lib/clipboard';
  import { canPersistLog } from '$lib/http/log-persist';

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
  let copied = $state<string | null>(null);
  let includeSecrets = $state(false);

  const entries = $derived(exchangeLog.entries);
  const failureCount = $derived(exchangeLog.failures.length);

  async function copy(text: string, label: string) {
    if (await copyToClipboard(text)) {
      copied = label;
      setTimeout(() => (copied = null), 1600);
    }
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

  function statusLabel(entry: (typeof entries)[number]): string {
    if (entry.response) return String(entry.response.status);
    return entry.outcome === 'blocked-precondition' ? 'blocked' : 'failed';
  }

  function statusClass(entry: (typeof entries)[number]): string {
    if (!entry.response) return 'text-error border-error/40';
    const status = entry.response.status;
    if (status < 300) return 'text-success border-success/40';
    if (status < 400) return 'text-info border-info/40';
    if (status < 500) return 'text-warning border-warning/40';
    return 'text-error border-error/40';
  }
</script>

<aside
  class="border-border bg-surface fixed inset-x-0 bottom-0 z-40 border-t"
  aria-label="Exchange log"
>
  <div class="mx-auto max-w-6xl px-4">
    <div class="flex items-center gap-3 py-2">
      <button
        type="button"
        class="text-fg-muted hover:text-fg flex items-center gap-2 text-xs"
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

      {#if exchangeLog.count > 0}
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="border-border text-fg-muted hover:text-fg rounded border px-2 py-0.5 text-[11px]"
            onclick={() => download('json')}
          >
            Download JSON
          </button>
          <button
            type="button"
            class="border-border text-fg-muted hover:text-fg rounded border px-2 py-0.5 text-[11px]"
            onclick={() => download('md')}
          >
            Download Markdown
          </button>
          <button
            type="button"
            class="border-border text-fg-muted hover:text-fg rounded border px-2 py-0.5 text-[11px]"
            onclick={() => exchangeLog.clear()}
          >
            Clear
          </button>
        </div>
      {/if}
    </div>

    {#if open}
      <div class="border-border/60 max-h-[26rem] overflow-auto border-t py-3">
        {#if exchangeLog.count === 0}
          <p class="text-fg-muted py-4 text-center text-sm">
            No requests yet. Run Diagnostics or send a FHIR query.
          </p>
        {:else}
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

          {#each entries as entry (entry.id)}
            <details class="border-border/40 border-b last:border-b-0">
              <summary
                class="hover:bg-surface-2/40 flex flex-wrap items-center gap-2 px-1 py-1.5 font-mono text-[11px]"
              >
                <span class="rounded border px-1.5 py-0.5 {statusClass(entry)}">
                  {statusLabel(entry)}
                </span>
                <span class="text-fg-muted w-14 shrink-0">{entry.request.method}</span>
                <span class="min-w-0 flex-1 truncate">{entry.request.url}</span>
                <span class="text-fg-muted shrink-0">{entry.durationMs}ms</span>
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
                      {#each entry.diagnosis.evidence as evidence (evidence)}
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

                <button
                  type="button"
                  class="border-border text-fg-muted hover:text-fg rounded border px-2 py-0.5"
                  onclick={() => copy(toCurl(entry, config.origin ?? ''), entry.id)}
                >
                  {copied === entry.id ? 'Copied' : 'Copy as curl'}
                </button>
              </div>
            </details>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</aside>
