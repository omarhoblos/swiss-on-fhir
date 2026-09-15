<script lang="ts">
  import { theme } from '$lib/theme.svelte';
  import Sun from '$lib/icons/Sun.svelte';
  import Moon from '$lib/icons/Moon.svelte';
</script>

<button
  type="button"
  onclick={() => theme.toggle()}
  class="text-fg-muted hover:text-fg hover:bg-surface-2 rounded p-2 transition-colors"
  aria-label={theme.isLight ? 'Switch to dark theme' : 'Switch to light theme'}
  title={theme.isLight ? 'Switch to dark theme' : 'Switch to light theme'}
>
  {#if theme.isLight}
    <Moon />
  {:else}
    <Sun />
  {/if}
</button>
