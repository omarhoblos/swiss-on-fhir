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
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import Close from '$lib/icons/Close.svelte';
  import Menu from '$lib/icons/Menu.svelte';
  import ThemeToggle from './ThemeToggle.svelte';

  /**
   * Real <a href> elements with aria-current, and active state DERIVED from
   * the URL. The Angular nav used click handlers calling router.navigate plus
   * a manually maintained `active` flag array, which broke middle-click,
   * cmd-click, browser back, and screen-reader semantics.
   *
   * Every item looks the same, signed in or not. Session and FHIR API used
   * to be dimmed without a session, but both are useful without one: the
   * Session page says how to get a token, and the FHIR API sends anonymous
   * requests, which is a legitimate test. Whether a session is active is
   * shown in the bottom bar instead.
   */
  const items = [
    { href: '/config', label: 'Config' },
    { href: '/diagnostics', label: 'Diagnostics' },
    { href: '/launch', label: 'Launch' },
    { href: '/', label: 'Session' },
    { href: '/fhir', label: 'FHIR API' }
  ];

  function isActive(href: string): boolean {
    return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
  }

  /**
   * Below the md breakpoint the links move behind a menu button. The brand,
   * five links and the theme toggle need about 600px in one row, and on a
   * phone that row pushed the page wider than the screen, so it scrolled
   * sideways into empty space.
   */
  let menuOpen = $state(false);

  /**
   * The nav stays in view while the page scrolls. Its height changes with the
   * breakpoint and with the menu open, so it is measured and published as
   * --nav-height for anything that has to sit or stop below it.
   */
  let navHeight = $state(0);
  $effect(() => {
    if (navHeight) document.documentElement.style.setProperty('--nav-height', `${navHeight}px`);
  });

  // Picking a page, or the back button, should not leave the menu covering it.
  afterNavigate(() => {
    menuOpen = false;
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && menuOpen) menuOpen = false;
  }
</script>

{#snippet link(item: (typeof items)[number], stacked: boolean)}
  <a
    href={item.href}
    aria-current={isActive(item.href) ? 'page' : undefined}
    class="rounded px-3 text-sm transition-colors
      {stacked ? 'block py-2.5' : 'py-1.5'}
      {isActive(item.href)
      ? 'bg-surface-2 text-primary font-medium'
      : 'text-fg-muted hover:text-fg'}"
  >
    {item.label}
  </a>
{/snippet}

<!-- On the window rather than the nav, so Escape works wherever focus is. -->
<svelte:window {onkeydown} />

<nav
  bind:offsetHeight={navHeight}
  class="border-border bg-surface sticky top-0 z-30 border-b"
  aria-label="Main"
>
  <div class="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2">
    <span
      class="text-primary mr-4 min-w-0 truncate text-xl font-semibold tracking-tight lg:text-[3em] lg:leading-tight"
      >Swiss on FHIR</span
    >

    <div class="hidden items-center gap-1 md:flex">
      {#each items as item (item.href)}
        {@render link(item, false)}
      {/each}
    </div>

    <div class="ml-auto flex shrink-0 items-center gap-1">
      <ThemeToggle />
      <button
        type="button"
        class="text-fg-muted hover:text-fg hover:bg-surface-2 rounded p-2 transition-colors md:hidden"
        aria-expanded={menuOpen}
        aria-controls="main-menu"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        onclick={() => (menuOpen = !menuOpen)}
      >
        {#if menuOpen}
          <Close />
        {:else}
          <Menu />
        {/if}
      </button>
    </div>
  </div>

  {#if menuOpen}
    <div id="main-menu" class="border-border border-t px-4 py-2 md:hidden">
      {#each items as item (item.href)}
        {@render link(item, true)}
      {/each}
    </div>
  {/if}
</nav>
