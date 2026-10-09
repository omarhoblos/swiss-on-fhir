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
  import ChevronDown from '$lib/icons/ChevronDown.svelte';

  /**
   * A button that opens a short menu of actions: the ARIA menu button.
   *
   * Opening moves focus to the first item; Arrow keys, Home and End move
   * between items; Enter or a click runs one; Escape closes and returns focus
   * to the button; Tab or a click anywhere else just closes. `placement`
   * opens the menu above the button, for one that sits at the bottom of the
   * screen, or below it.
   */
  let {
    label,
    items,
    placement = 'down',
    class: klass = ''
  }: {
    label: string;
    items: readonly { label: string; onselect: () => void }[];
    placement?: 'up' | 'down';
    /** Classes for the button itself. */
    class?: string;
  } = $props();

  const uid = $props.id();
  let open = $state(false);
  let root = $state<HTMLElement>();
  let button = $state<HTMLButtonElement>();
  const itemButtons: HTMLButtonElement[] = $state([]);

  function show(focusIndex: number) {
    open = true;
    // After the menu renders.
    queueMicrotask(() => itemButtons[focusIndex]?.focus());
  }

  function close(returnFocus: boolean) {
    open = false;
    if (returnFocus) button?.focus();
  }

  function choose(item: { onselect: () => void }) {
    close(true);
    item.onselect();
  }

  function onButtonKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show(event.key === 'ArrowDown' ? 0 : items.length - 1);
    }
  }

  function onMenuKey(event: KeyboardEvent) {
    const at = itemButtons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      itemButtons[(to + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') close(false);
  }

  // A press anywhere outside closes it.
  $effect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) close(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  });
</script>

<div class="relative" bind:this={root}>
  <button
    bind:this={button}
    type="button"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls="{uid}-menu"
    onclick={() => (open ? close(false) : show(0))}
    onkeydown={onButtonKey}
    class="flex items-center gap-1 {klass}"
  >
    {label}
    <ChevronDown class="h-3 w-3 {placement === 'up' ? 'rotate-180' : ''}" />
  </button>
  {#if open}
    <ul
      id="{uid}-menu"
      role="menu"
      aria-label={label}
      tabindex="-1"
      onkeydown={onMenuKey}
      class="bg-surface border-border absolute right-0 z-50 min-w-28 rounded-md border py-1 shadow-lg
        {placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'}"
    >
      {#each items as item, i (item.label)}
        <li role="none">
          <button
            bind:this={itemButtons[i]}
            type="button"
            role="menuitem"
            tabindex="-1"
            onclick={() => choose(item)}
            class="hover:bg-surface-2 focus:bg-surface-2 block w-full px-3 py-1.5 text-left text-xs"
          >
            {item.label}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
