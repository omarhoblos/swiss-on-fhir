<script lang="ts">
  import type { Severity } from '$lib/config/types';
  import type { Snippet } from 'svelte';

  let {
    severity = 'error',
    title,
    children
  }: { severity?: Severity; title?: string; children?: Snippet } = $props();

  const styles: Record<Severity, string> = {
    error: 'border-error/50 bg-error/10 text-error',
    warning: 'border-warning/50 bg-warning/10 text-warning',
    info: 'border-info/50 bg-info/10 text-info'
  };
</script>

<div
  class="rounded-md border px-3 py-2 text-sm {styles[severity]}"
  role={severity === 'error' ? 'alert' : 'status'}
>
  {#if title}
    <p class="font-semibold">{title}</p>
  {/if}
  <div class="text-fg/90 [&:not(:first-child)]:mt-1">
    {@render children?.()}
  </div>
</div>
