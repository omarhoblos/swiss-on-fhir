<script lang="ts">
  import { page } from '$app/state';
  import ThemeToggle from './ThemeToggle.svelte';

  /**
   * Real <a href> elements with aria-current, and active state DERIVED from
   * the URL. The Angular nav used click handlers calling router.navigate plus
   * a manually maintained `active` flag array, which broke middle-click,
   * cmd-click, browser back, and screen-reader semantics.
   *
   * Session-gated items are rendered dimmed rather than `display: none`.
   * Hiding them (as the old nav did) meant a new user could not tell the
   * features existed, and Config/Diagnostics specifically must be reachable
   * BEFORE authentication works -- that is the whole point of the tool.
   */
  let { hasSession = false }: { hasSession?: boolean } = $props();

  const items = [
    { href: '/config', label: 'Config', needsSession: false },
    { href: '/diagnostics', label: 'Diagnostics', needsSession: false },
    { href: '/launch', label: 'Launch', needsSession: false },
    { href: '/', label: 'Tokens', needsSession: true },
    { href: '/fhir', label: 'FHIR API', needsSession: true }
  ];

  function isActive(href: string): boolean {
    return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
  }
</script>

<nav class="border-border bg-surface border-b" aria-label="Main">
  <div class="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2">
    <span class="text-primary mr-4 text-[3em] font-semibold tracking-tight">Swiss on FHIR</span>

    {#each items as item (item.href)}
      {@const dimmed = item.needsSession && !hasSession}
      <a
        href={item.href}
        aria-current={isActive(item.href) ? 'page' : undefined}
        aria-disabled={dimmed ? 'true' : undefined}
        title={dimmed ? 'Available once you have an access token' : undefined}
        class="rounded px-3 py-1.5 text-sm transition-colors
          {isActive(item.href)
          ? 'bg-surface-2 text-primary font-medium'
          : 'text-fg-muted hover:text-fg'}
          {dimmed ? 'opacity-45' : ''}"
      >
        {item.label}
      </a>
    {/each}

    <div class="ml-auto">
      <ThemeToggle />
    </div>
  </div>
</nav>
