<script lang="ts">
  import { config } from '$lib/config/config.svelte';
  import { toCurl } from '$lib/http/exchange';
  import type { CheckResult, RemediationAction } from '$lib/diagnostics/types';
  import Markdown from './Markdown.svelte';
  import CopyButton from './ui/CopyButton.svelte';
  import UrlLink from './UrlLink.svelte';

  let { check }: { check: CheckResult } = $props();

  const meta: Record<CheckResult['status'], { icon: string; label: string; class: string }> = {
    pass: { icon: '✓', label: 'Pass', class: 'text-success border-success/40' },
    warn: { icon: '!', label: 'Warning', class: 'text-warning border-warning/40' },
    fail: { icon: '✕', label: 'Fail', class: 'text-error border-error/40' },
    skip: { icon: '–', label: 'Skipped', class: 'text-fg-muted border-border' },
    manual: { icon: '?', label: 'Manual', class: 'text-info border-info/40' },
    running: { icon: '⋯', label: 'Running', class: 'text-fg-muted border-border' }
  };

  let copied = $state<string | null>(null);

  async function act(action: RemediationAction) {
    if (action.kind === 'set-config' && action.patch) {
      for (const [key, value] of Object.entries(action.patch)) {
        config.set(key as never, value as never);
      }
      copied = action.label;
    } else if (action.kind === 'copy' && action.value) {
      await navigator.clipboard.writeText(action.value).catch(() => {});
      copied = action.label;
    } else if (action.kind === 'open-url' && action.value) {
      window.open(action.value, '_blank', 'noopener,noreferrer');
    }
    setTimeout(() => (copied = null), 1600);
  }

  /**
   * Only expand a row by default when it needs attention. A clean run should
   * be scannable, not a wall of open panels.
   */
  const openByDefault = $derived(check.status === 'fail' || check.status === 'warn');
</script>

<details
  id="check-{check.id}"
  open={openByDefault}
  class="border-border/60 [&_summary]:hover:bg-surface-2/40 border-b last:border-b-0"
>
  <summary class="flex items-start gap-3 px-4 py-2.5">
    <span
      class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] {meta[
        check.status
      ].class}"
      title={meta[check.status].label}
      aria-label={meta[check.status].label}
    >
      {meta[check.status].icon}
    </span>
    <span class="min-w-0 flex-1">
      <span class="text-sm font-medium">{check.title}</span>
      <span class="text-fg-muted mt-0.5 block text-xs"
        ><Markdown text={check.summary} inline /></span
      >
    </span>
    {#if check.durationMs > 0}
      <span class="text-fg-muted shrink-0 font-mono text-[10px]">{check.durationMs}ms</span>
    {/if}
  </summary>

  <div class="space-y-3 px-4 pb-4 pl-12">
    {#if check.detail}
      <div class="text-fg-muted text-xs"><Markdown text={check.detail} /></div>
    {/if}

    {#if check.spec}
      <p class="text-xs">
        <a
          href={check.spec.url}
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary hover:underline"
        >
          {check.spec.name}{check.spec.section ? ` §${check.spec.section}` : ''}
        </a>
      </p>
    {/if}

    {#each check.remediations as rem (rem.id)}
      <div class="border-border bg-bg rounded-md border px-3 py-2">
        <p class="text-sm font-medium">{rem.label}</p>
        <div class="text-fg-muted mt-1 text-xs"><Markdown text={rem.body} /></div>
        {#if rem.actions && rem.actions.length > 0}
          <div class="mt-2 flex flex-wrap gap-2">
            {#each rem.actions as action (action.label)}
              <button
                type="button"
                class="border-primary text-primary hover:bg-primary rounded border px-2 py-1 text-xs hover:text-white"
                onclick={() => act(action)}
              >
                {copied === action.label ? 'Done' : action.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#each check.exchanges as exchange (exchange.id)}
      <details class="border-border rounded-md border">
        <summary class="flex flex-wrap items-center gap-2 px-3 py-1.5 font-mono text-[11px]">
          <span class="text-fg-muted">{exchange.request.method}</span>
          <span class="min-w-0 truncate">
            <UrlLink
              value={exchange.request.url}
              class="hover:text-primary underline decoration-dotted underline-offset-2"
            />
          </span>
          <span class="text-fg-muted ml-auto">
            {exchange.response
              ? `${exchange.response.status} ${exchange.response.statusText}`
              : exchange.outcome}
          </span>
          <CopyButton value={() => toCurl(exchange, config.origin ?? '')} label="Copy as curl" />
        </summary>
        <div class="space-y-2 px-3 pb-3 text-[11px]">
          {#if exchange.redactions.length > 0}
            <p class="text-warning">Redacted: {exchange.redactions.join(', ')}</p>
          {/if}
          {#if exchange.diagnosis}
            <div>
              <p class="font-medium">
                Likely cause: {exchange.diagnosis.likelyCause} ({exchange.diagnosis.confidence})
              </p>
              <ul class="text-fg-muted mt-1 list-outside list-disc space-y-0.5 pl-4">
                {#each exchange.diagnosis.evidence as e (e)}
                  <li>{e}</li>
                {/each}
              </ul>
            </div>
          {/if}
          {#if exchange.response?.body}
            <pre
              class="bg-bg border-border max-h-64 overflow-auto rounded border p-2 font-mono">{exchange
                .response.body}</pre>
          {/if}
        </div>
      </details>
    {/each}
  </div>
</details>
