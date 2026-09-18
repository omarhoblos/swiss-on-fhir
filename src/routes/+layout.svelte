<!--
 Copyright 2021 Omar Hoblos

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
-->

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
