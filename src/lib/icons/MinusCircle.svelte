<script lang="ts">
  let { class: klass = 'h-5 w-5' }: { class?: string } = $props();
</script>

<svg
  class={klass}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  aria-hidden="true"
>
  <circle cx="12" cy="12" r="9" />
  <path d="M8 12h8" />
</svg>
