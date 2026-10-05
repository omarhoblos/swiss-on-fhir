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
  import type { Snippet } from 'svelte';

  let {
    title,
    subtitle,
    actions,
    head,
    sticky = false,
    children
  }: {
    title?: string;
    subtitle?: string;
    actions?: Snippet;
    /** More of the header, under the title row: what should stay with it. */
    head?: Snippet;
    /** Keeps the header in view, under the main nav, while the card scrolls past. */
    sticky?: boolean;
    children?: Snippet;
  } = $props();
</script>

<!--
  Below the sm breakpoint the header stacks, with any actions under the
  title. Side by side on a phone, a row of buttons left the title a column
  a word or two wide: "Access token lifetime" ran to three lines beside
  Refresh, Revoke and Discard.

  A sticky header sits just below the main nav (--nav-height, kept by
  Nav.svelte) and stays there until the card has scrolled past.
-->
<section class="border-border bg-surface rounded-lg border">
  {#if title || actions || head}
    <header
      class="border-border border-b px-4 py-3 {sticky
        ? 'bg-surface sticky top-[var(--nav-height)] z-20 rounded-t-lg'
        : ''}"
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div class="min-w-0">
          {#if title}<h2 class="font-semibold break-words">{title}</h2>{/if}
          {#if subtitle}<p class="text-fg-muted mt-0.5 text-xs">{subtitle}</p>{/if}
        </div>
        {#if actions}
          <div class="flex flex-wrap items-center gap-2 sm:shrink-0" data-card-actions>
            {@render actions()}
          </div>
        {/if}
      </div>
      {#if head}
        <div class="mt-3">{@render head()}</div>
      {/if}
    </header>
  {/if}
  <div class="px-4 py-3">
    {@render children?.()}
  </div>
</section>
