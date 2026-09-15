<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  /**
   * Catch-all, replacing Angular's `{ path: '**', redirectTo: '' }`.
   *
   * It exists mainly for redirect-URI compatibility. Existing Swiss client
   * definitions are registered against three different landing shapes:
   *
   *   /            - a real route (the value the Angular code actually used)
   *   /callback    - a real route (the new default)
   *   /index.html  - nginx serves the file, then the router finds no route
   *                  and lands here
   *
   * So if the URL carries OAuth parameters, hand off to the callback handler
   * instead of bouncing the user to the home page and losing the code.
   */
  const hasOauthParams = $derived(
    ['code', 'state', 'error'].some((k) => page.url.searchParams.has(k))
  );

  onMount(() => {
    if (hasOauthParams) {
      // Preserve the query string so the callback route can consume it.
      void goto(`/callback${page.url.search}`, { replaceState: true });
    } else {
      void goto('/', { replaceState: true });
    }
  });
</script>

<p class="text-fg-muted text-sm">Redirecting…</p>
