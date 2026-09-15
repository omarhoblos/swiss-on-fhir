<script lang="ts">
  import '../app.css';
  import Nav from '$lib/components/Nav.svelte';
  import Footer from '$lib/components/Footer.svelte';

  let { children } = $props();
</script>

<div class="flex min-h-screen flex-col">
  <Nav />
  <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
    {@render children?.()}
  </main>
  <Footer />
</div>
