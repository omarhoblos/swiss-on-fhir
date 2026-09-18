<script lang="ts">
  import type { GrantedScopes, ScopeDiff } from '$lib/smart/scopes';
  import { hasRealReduction } from '$lib/smart/scopes';

  let { diff, source }: { diff: ScopeDiff; source: GrantedScopes['source'] } = $props();

  const reduced = $derived(hasRealReduction(diff));
</script>

<div class="space-y-3">
  <p class="text-sm">
    {#if reduced}
      <span class="text-warning font-medium"> You hold fewer permissions than you asked for. </span>
    {:else if diff.normalized.length > 0}
      <span class="text-success font-medium">
        Everything you asked for was granted, with some scopes rewritten.
      </span>
    {:else}
      <span class="text-success font-medium">Everything you asked for was granted.</span>
    {/if}
  </p>

  {#if source === 'access-token'}
    <p class="text-fg-muted text-xs">
      The token response has no <code class="font-mono">scope</code>, so these are read from the
      access token&rsquo;s own <code class="font-mono">scope</code> claim. SMART Backend Services
      requires <code class="font-mono">scope</code> in the response; a stricter client would have nothing
      to go on.
    </p>
  {:else if source === 'implied'}
    <p class="text-fg-muted text-xs">
      Neither the token response nor the access token states a scope. RFC 6749 treats an omitted
      <code class="font-mono">scope</code> as &ldquo;granted exactly as requested&rdquo;, so that is what
      is shown &mdash; but nothing here confirms it. A 403 from the FHIR server is the first sign it was
      not.
    </p>
  {/if}

  {#if diff.dropped.length > 0}
    <div>
      <p class="text-error text-xs font-medium">Not granted ({diff.dropped.length})</p>
      <ul class="mt-1 space-y-0.5">
        {#each diff.dropped as scope (scope.raw)}
          <li class="font-mono text-xs">{scope.raw}</li>
        {/each}
      </ul>
      <p class="text-fg-muted mt-1 text-xs">
        A server may withhold a scope because it is not configured for this client, because the user
        declined it, or because it is not supported at all.
      </p>
    </div>
  {/if}

  {#if diff.narrowed.length > 0}
    <div>
      <p class="text-warning text-xs font-medium">Narrowed ({diff.narrowed.length})</p>
      <ul class="mt-1 space-y-0.5">
        {#each diff.narrowed as change (change.from.raw)}
          <li class="font-mono text-xs">
            {change.from.raw} <span class="text-fg-muted">&rarr;</span>
            {change.to.raw}
          </li>
        {/each}
      </ul>
      <p class="text-fg-muted mt-1 text-xs">A real reduction in permission, not just a rewrite.</p>
    </div>
  {/if}

  {#if diff.covered.length > 0}
    <div>
      <p class="text-success text-xs font-medium">
        Granted by a broader scope ({diff.covered.length})
      </p>
      <ul class="mt-1 space-y-0.5">
        {#each diff.covered as change (change.from.raw)}
          <li class="font-mono text-xs">
            {change.from.raw} <span class="text-fg-muted">&larr;</span>
            {change.by.raw}
          </li>
        {/each}
      </ul>
      <p class="text-fg-muted mt-1 text-xs">
        The server combined these into a wider grant. You hold at least what you asked for.
      </p>
    </div>
  {/if}

  {#if diff.normalized.length > 0}
    <div>
      <p class="text-info text-xs font-medium">Rewritten ({diff.normalized.length})</p>
      <ul class="mt-1 space-y-0.5">
        {#each diff.normalized as change (change.from.raw)}
          <li class="font-mono text-xs">
            {change.from.raw} <span class="text-fg-muted">&rarr;</span>
            {change.to.raw}
          </li>
        {/each}
      </ul>
      <p class="text-fg-muted mt-1 text-xs">
        Same permission, different syntax &mdash; your server normalised SMART 1.0 scopes to SMART
        2.0. Not a reduction, which is why Swiss reports it separately.
      </p>
    </div>
  {/if}

  {#if diff.added.length > 0}
    <div>
      <p class="text-fg-muted text-xs font-medium">Added by the server ({diff.added.length})</p>
      <ul class="mt-1 space-y-0.5">
        {#each diff.added as scope (scope.raw)}
          <li class="font-mono text-xs">{scope.raw}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if diff.unchanged.length > 0}
    <details open>
      <summary class="text-fg-muted cursor-pointer text-xs">
        Granted as requested ({diff.unchanged.length})
      </summary>
      <ul class="mt-1 space-y-0.5 pl-3">
        {#each diff.unchanged as scope (scope.raw)}
          <li class="text-success font-mono text-xs">{scope.raw}</li>
        {/each}
      </ul>
    </details>
  {/if}
</div>
