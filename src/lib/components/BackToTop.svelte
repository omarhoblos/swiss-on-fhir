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
  import ArrowUp from '$lib/icons/ArrowUp.svelte';

  /**
   * Back to top, on every page. The button appears once the page has
   * scrolled SHOW_AFTER pixels, which is enough to take the page heading out
   * of view. It waited for a full screen at first, and so never appeared on
   * pages that scroll less than that, like the FHIR API screen, whose
   * response scrolls inside its own box. It scrolls back smoothly unless the
   * reader asked for reduced motion, and moves focus to the page's heading so the keyboard starts from
   * the top too. It sits above the exchange log bar and under its drawer.
   */
  const SHOW_AFTER = 200;
  let scrollY = $state(0);
  const scrolledDown = $derived(scrollY > SHOW_AFTER);

  function backToTop() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    const target = document.querySelector<HTMLElement>('main h1') ?? document.querySelector('main');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
</script>

<svelte:window bind:scrollY />

{#if scrolledDown}
  <button
    type="button"
    onclick={backToTop}
    aria-label="Back to top"
    title="Back to top"
    class="border-border-control bg-surface text-fg-muted hover:border-primary hover:text-primary fixed right-4 bottom-14 z-30 rounded-full border p-3 shadow-lg motion-safe:transition-colors"
  >
    <ArrowUp />
  </button>
{/if}
