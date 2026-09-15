<script lang="ts">
  import { copyToClipboard } from '$lib/clipboard';
  import { fromEpochSeconds, formatAbsolute } from '$lib/time';
  import type { JwtClaims, JwtHeader } from '$lib/oidc/jwt';

  let {
    title,
    token,
    header,
    claims,
    sensitive = false,
    note
  }: {
    title: string;
    token?: string;
    header?: JwtHeader;
    claims?: JwtClaims;
    /** Masks the value until revealed. */
    sensitive?: boolean;
    note?: string;
  } = $props();

  let copied = $state(false);
  // null means "follow the prop"; a boolean is the user's explicit choice.
  // Initialising $state from a prop directly would freeze it at the first value.
  let revealedOverride = $state<boolean | null>(null);
  const revealed = $derived(revealedOverride ?? !sensitive);

  async function copy() {
    if (!token) return;
    // Never logs the value, unlike the Angular implementation.
    copied = await copyToClipboard(token);
    setTimeout(() => (copied = false), 1600);
  }

  const claimEntries = $derived(claims ? Object.entries(claims) : []);

  /** Renders epoch-second claims as dates, which is what you want to read. */
  function renderClaim(key: string, value: unknown): string {
    if (['exp', 'iat', 'nbf', 'auth_time'].includes(key) && typeof value === 'number') {
      return `${value}  (${formatAbsolute(fromEpochSeconds(value))})`;
    }
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return String(value);
  }
</script>

<details class="border-border/60 border-b last:border-b-0">
  <summary class="hover:bg-surface-2/40 flex items-center gap-2 px-4 py-2.5">
    <span class="text-sm font-medium">{title}</span>
    {#if !token && !claims}
      <span class="text-fg-muted text-xs">not present</span>
    {/if}
  </summary>

  <div class="space-y-3 px-4 pb-4">
    {#if note}
      <p class="text-fg-muted text-xs">{note}</p>
    {/if}

    {#if token}
      <div>
        <div class="flex flex-wrap items-center gap-2">
          {#if sensitive && !revealed}
            <button
              type="button"
              class="border-border text-fg-muted hover:text-fg rounded border px-2 py-1 text-xs"
              onclick={() => (revealedOverride = true)}
            >
              Reveal
            </button>
            <span class="text-fg-muted font-mono text-xs">
              {token.slice(0, 6)}&hellip;{token.slice(-4)}
            </span>
          {:else}
            <button
              type="button"
              class="bg-primary rounded px-2 py-1 text-xs font-medium text-white"
              onclick={copy}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            {#if sensitive}
              <button
                type="button"
                class="border-border text-fg-muted hover:text-fg rounded border px-2 py-1 text-xs"
                onclick={() => (revealedOverride = false)}
              >
                Hide
              </button>
            {/if}
          {/if}
        </div>
        {#if revealed}
          <pre
            class="bg-bg border-border mt-2 max-h-40 overflow-auto rounded border p-2 font-mono text-[11px] break-all whitespace-pre-wrap">{token}</pre>
        {/if}
      </div>
    {/if}

    {#if header}
      <div>
        <p class="text-fg-muted text-xs font-medium">Header</p>
        <dl class="mt-1 space-y-0.5">
          {#each Object.entries(header) as [key, value] (key)}
            <div class="flex gap-2 font-mono text-[11px]">
              <dt class="text-json-key w-32 shrink-0">{key}</dt>
              <dd class="break-all">{String(value)}</dd>
            </div>
          {/each}
        </dl>
      </div>
    {/if}

    {#if claimEntries.length > 0}
      <div>
        <p class="text-fg-muted text-xs font-medium">Claims</p>
        <dl class="mt-1 space-y-0.5">
          {#each claimEntries as [key, value] (key)}
            <div class="flex gap-2 font-mono text-[11px]">
              <dt class="text-json-key w-32 shrink-0">{key}</dt>
              <dd class="break-all">{renderClaim(key, value)}</dd>
            </div>
          {/each}
        </dl>
      </div>
    {/if}
  </div>
</details>
