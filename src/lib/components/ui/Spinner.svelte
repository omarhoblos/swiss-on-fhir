<script lang="ts">
  /**
   * A small busy indicator for page titles. `label` is announced to screen
   * readers, so it says what is in progress rather than just "loading".
   */
  let { label, class: klass = 'h-5 w-5' }: { label: string; class?: string } = $props();
</script>

<span role="status" class="text-primary inline-flex items-center">
  <svg
    class="{klass} motion-safe:animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" class="opacity-25" />
    <path d="M21 12a9 9 0 0 0-9-9" />
  </svg>
  <span class="sr-only">{label}</span>
</span>
