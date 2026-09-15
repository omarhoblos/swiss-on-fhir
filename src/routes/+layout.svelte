<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { clock, session } from '$lib/auth/session.svelte';
  import { pruneExpired } from '$lib/auth/transaction';
  import { exchangeLog } from '$lib/http/log.svelte';
  import Nav from '$lib/components/Nav.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import ExchangeLogDrawer from '$lib/components/ExchangeLogDrawer.svelte';

  let { children } = $props();

  onMount(() => {
    pruneExpired();
    // Restores the redacted log so events survive a reload and, importantly,
    // the OAuth redirect -- otherwise the handshake that just failed is gone.
    void exchangeLog.hydrate();
  });

  // ONE interval for the whole app, feeding one signal that every countdown
  // derives from. Kept here rather than in the session store so there is no
  // leaked $effect.root() and the store stays free of lifecycle concerns.
  $effect(() => {
    const id = setInterval(() => {
      clock.now = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });
</script>

<div class="flex min-h-screen flex-col pb-12">
  <Nav hasSession={session.isAuthenticated} />
  <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
    {@render children?.()}
  </main>
  <Footer />
</div>

<ExchangeLogDrawer />
