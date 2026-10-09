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
  import type { Suggestion } from '$lib/fhir/known-headers';

  /**
   * A text box with a list of suggestions: the ARIA 1.2 editable combobox
   * with list autocomplete. Anything can be typed; the list only offers.
   *
   * Focusing the box opens the whole list, so what is on offer is seen
   * without knowing to ask; typing then filters it on each option's value
   * and description. Arrow Down, or the chevron, opens it again after
   * Escape or a pick. Enter takes the highlighted
   * option, Escape closes the list. Options are taken on mousedown with the
   * default prevented, so the input keeps focus and its blur does not close
   * the list before the click lands.
   *
   * Not a `<datalist>`: each browser draws that differently, Firefox lists
   * nothing until something is typed, and it cannot show a description.
   */
  let {
    value = $bindable(''),
    options,
    label,
    listLabel,
    placeholder,
    onselect,
    oninput,
    class: klass = ''
  }: {
    value?: string;
    options: readonly Suggestion[];
    /** The input's accessible name. */
    label: string;
    /** Names the list, and the chevron as "Show <listLabel>". */
    listLabel: string;
    placeholder?: string;
    /** Called after an option is taken, not on typing. */
    onselect?: (value: string) => void;
    /** Called on typing, after the value has changed. */
    oninput?: () => void;
    class?: string;
  } = $props();

  const uid = $props.id();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-option-${i}`;

  let input = $state<HTMLInputElement>();
  let open = $state(false);
  /** Opened from the chevron or the keyboard: list everything, not just matches. */
  let showAll = $state(false);
  let active = $state(-1);

  const shown = $derived.by(() => {
    const q = value.trim().toLowerCase();
    if (showAll || !q) return options;
    return options.filter(
      (o) => o.value.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q)
    );
  });
  const expanded = $derived(open && shown.length > 0);

  $effect(() => {
    if (expanded && active >= 0) {
      document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    }
  });

  function show(all: boolean, highlight: number) {
    open = true;
    showAll = all;
    active = highlight;
  }

  function close() {
    open = false;
    active = -1;
  }

  function pick(option: Suggestion) {
    value = option.value;
    close();
    onselect?.(option.value);
  }

  function onkeydown(event: KeyboardEvent) {
    const count = shown.length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!expanded) show(true, event.altKey ? -1 : 0);
        else active = (active + 1) % count;
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!expanded) show(true, options.length - 1);
        else active = active <= 0 ? count - 1 : active - 1;
        break;
      case 'Enter': {
        const option = expanded ? shown[active] : undefined;
        if (option) {
          event.preventDefault();
          pick(option);
        }
        break;
      }
      case 'Escape':
        if (expanded) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        break;
      case 'Tab':
        close();
        break;
    }
  }

  function toggle() {
    if (expanded) close();
    else show(true, -1);
    input?.focus();
  }
</script>

<div class="relative {klass}">
  <input
    bind:this={input}
    bind:value
    oninput={() => {
      show(false, -1);
      oninput?.();
    }}
    onfocus={() => show(true, -1)}
    {onkeydown}
    onblur={close}
    type="text"
    role="combobox"
    aria-label={label}
    aria-expanded={expanded}
    aria-controls={listId}
    aria-autocomplete="list"
    aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
    {placeholder}
    spellcheck="false"
    autocomplete="off"
    class="border-border-control bg-bg w-full rounded-md border py-1.5 pr-8 pl-2 font-mono text-sm"
  />
  <button
    type="button"
    tabindex="-1"
    aria-label="Show {listLabel}"
    title="Show {listLabel}"
    onmousedown={(e) => e.preventDefault()}
    onclick={toggle}
    class="text-fg-muted hover:text-fg hover:bg-surface-2 absolute inset-y-0 right-1 my-auto h-6 rounded px-1"
  >
    <ChevronDown class="h-4 w-4" />
  </button>
  <ul
    id={listId}
    role="listbox"
    aria-label={listLabel}
    hidden={!expanded}
    class="bg-surface border-border absolute top-full right-0 left-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-md border py-1 shadow-lg"
  >
    {#each expanded ? shown : [] as option, i (option.value)}
      <li
        id={optionId(i)}
        role="option"
        aria-selected={i === active}
        onmousedown={(e) => {
          e.preventDefault();
          pick(option);
        }}
        onmousemove={() => (active = i)}
        class="cursor-pointer px-2 py-1.5 text-sm {i === active ? 'bg-surface-2' : ''}"
      >
        <span class="font-mono">{option.value}</span>
        {#if option.description}
          <span class="text-fg-muted block text-xs">{option.description}</span>
        {/if}
      </li>
    {/each}
  </ul>
</div>
