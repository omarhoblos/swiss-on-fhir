<script lang="ts">
  import { httpUrl } from '$lib/url';

  /**
   * A URL Swiss is displaying, linked when it can be.
   *
   * Opening a URL in a new tab is one of the few things that definitively
   * resolves a CORS failure -- if it loads there and not here, it is CORS and
   * nothing else -- so every URL on screen is worth making clickable.
   *
   * `stopPropagation` because these appear inside <summary>: a link is the
   * activation target in preference to the summary, but stopping the click
   * keeps any surrounding toggle handler out of it too.
   */
  let {
    value,
    class: className = 'text-primary underline underline-offset-2'
  }: { value: string; class?: string } = $props();

  const href = $derived(httpUrl(value));
</script>

{#if href}
  <a
    {href}
    target="_blank"
    rel="noopener noreferrer"
    class={className}
    onclick={(event) => event.stopPropagation()}>{value}</a
  >
{:else}
  {value}
{/if}
