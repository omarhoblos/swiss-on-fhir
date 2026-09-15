<script lang="ts">
  import { page } from '$app/state';
</script>

<div class="mx-auto max-w-lg py-16 text-center">
  <h1 class="text-primary text-5xl font-semibold">{page.status}</h1>
  <p class="text-fg-muted mt-4">{page.error?.message ?? 'Something went wrong.'}</p>
  <a href="/" class="text-primary mt-8 inline-block text-sm hover:underline">Back to Tokens</a>
</div>
