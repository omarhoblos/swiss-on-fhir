<script lang="ts">
  import { session } from '$lib/auth/session.svelte';
  import { formatCountdown, formatAbsolute } from '$lib/time';

  /**
   * Ticks. The Angular version computed its remaining time once, against a
   * `CURRENT_DATE` captured at component construction, so the banner was
   * frozen at whatever it read when the page loaded. Here the value derives
   * from the shared clock signal that the root layout advances every second.
   */
  const remaining = $derived(session.secondsRemaining);
  const expiresAt = $derived(session.current?.expiresAt ?? null);

  const tone = $derived(
    remaining === null
      ? 'text-fg-muted'
      : remaining < 0
        ? 'text-error'
        : remaining < 300
          ? 'text-warning'
          : 'text-fg-muted'
  );
</script>

<div class="flex flex-wrap items-baseline gap-2 text-sm">
  {#if remaining === null}
    <span class="text-fg-muted">
      Lifetime unknown &mdash; the server sent no <code class="font-mono text-xs">expires_in</code>
      and the access token is not a JWT with an <code class="font-mono text-xs">exp</code> claim.
    </span>
  {:else}
    <span class={tone}>
      {remaining < 0 ? 'Access token' : 'Expires in'}
      <span class="font-mono">{formatCountdown(remaining)}</span>
    </span>
    {#if expiresAt}
      <span class="text-fg-muted text-xs">({formatAbsolute(new Date(expiresAt))})</span>
    {/if}
  {/if}

  {#if session.hasClockSkew}
    <span class="text-warning text-xs">
      &middot; clock skew {session.clockSkewSeconds}s between the server&rsquo;s
      <code class="font-mono">exp</code> and its <code class="font-mono">expires_in</code>
    </span>
  {/if}
</div>
