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
  import { config } from '#lib/config/config.svelte.ts';
  import { requestTabs, type RequestTab } from '#lib/fhir/request-tabs.svelte.ts';
  import { MAX_REQUEST_TABS, MAX_TAB_NAME_LENGTH } from '#lib/fhir/request-tabs.ts';
  import MenuButton from './ui/MenuButton.svelte';

  /**
   * The FHIR console's request tabs, as ARIA tabs.
   *
   * Each tab shows its environment over its request. Choosing one switches
   * the app to that environment. Arrow keys, Home and End move between tabs
   * and Enter or Space chooses one: moving alone does not switch, since a
   * switch stops what the old environment had in flight. F2 or a
   * double-click renames a tab (up to 64 characters), and Delete or a
   * middle click closes it. Tabs are reordered by dragging, or from the
   * keyboard with Shift and an arrow key.
   */
  let { panelId }: { panelId: string } = $props();

  let renaming = $state<string | null>(null);
  let draftName = $state('');
  let nameInput = $state<HTMLInputElement>();
  /** The tab being dragged, and where it would land. */
  let dragging = $state<string | null>(null);
  let dropAt = $state<{ id: string; after: boolean } | null>(null);
  /** Its own type, so a tab dropped on a text box does not paste anything. */
  const DRAG_TYPE = 'application/x-swiss-request-tab';
  // Elements, not state: looked up to move focus.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const buttons = new Map<string, HTMLButtonElement>();

  const NEW_TAB_CLASS =
    'border-border-control text-fg-muted hover:text-fg shrink-0 self-center rounded border px-2 py-1 text-xs whitespace-nowrap';

  function environmentName(id: string): string {
    return config.environmentById(id)?.name ?? id;
  }

  function remember(node: HTMLButtonElement, id: string) {
    buttons.set(id, node);
    return { destroy: () => buttons.delete(id) };
  }

  function focusTab(id: string | undefined) {
    if (!id) return;
    queueMicrotask(() => buttons.get(id)?.focus());
  }

  function startRename(tab: RequestTab) {
    renaming = tab.id;
    draftName = tab.name;
    queueMicrotask(() => nameInput?.select());
  }

  function finishRename(save: boolean) {
    const id = renaming;
    if (!id) return;
    if (save) requestTabs.rename(id, draftName);
    renaming = null;
    focusTab(id);
  }

  function close(tab: RequestTab) {
    requestTabs.close(tab.id);
    focusTab(requestTabs.selected?.id);
  }

  function onDragStart(event: DragEvent, tab: RequestTab) {
    dragging = tab.id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Firefox starts a drag only when something is set.
      event.dataTransfer.setData(DRAG_TYPE, tab.id);
    }
  }

  function onDragOver(event: DragEvent, tab: RequestTab) {
    if (!dragging) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (tab.id === dragging) {
      dropAt = null;
      return;
    }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropAt = { id: tab.id, after: event.clientX > box.left + box.width / 2 };
  }

  function onDrop(event: DragEvent) {
    if (!dragging) return;
    event.preventDefault();
    if (dropAt) requestTabs.move(dragging, dropAt.id, dropAt.after);
    endDrag();
  }

  function endDrag() {
    dragging = null;
    dropAt = null;
  }

  function onTabKey(event: KeyboardEvent, index: number) {
    const tabs = requestTabs.tabs;
    const tab = tabs[index]!;
    if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const right = event.key === 'ArrowRight';
      const neighbour = tabs[index + (right ? 1 : -1)];
      if (!neighbour) return;
      requestTabs.move(tab.id, neighbour.id, right);
      focusTab(tab.id);
      return;
    }
    const move = (to: number) => {
      event.preventDefault();
      focusTab(tabs[(to + tabs.length) % tabs.length]?.id);
    };
    if (event.key === 'ArrowRight') move(index + 1);
    else if (event.key === 'ArrowLeft') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(tabs.length - 1);
    else if (event.key === 'F2') {
      event.preventDefault();
      startRename(tab);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      close(tab);
    }
  }

  function onNameKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      finishRename(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishRename(false);
    }
  }
</script>

<div class="border-border flex items-end gap-2 border-b">
  <div
    role="tablist"
    aria-label="Requests"
    class="-mb-px flex min-w-0 flex-1 overflow-x-auto"
    data-testid="request-tabs"
  >
    {#each requestTabs.tabs as tab, index (tab.id)}
      {@const selected = tab.id === requestTabs.selected?.id}
      {#if renaming === tab.id}
        <div class="border-primary bg-surface flex min-w-40 flex-col border-b-2 px-3 py-1.5">
          <span class="text-fg-muted truncate text-[11px]"
            >{environmentName(tab.environmentId)}</span
          >
          <input
            bind:this={nameInput}
            bind:value={draftName}
            maxlength={MAX_TAB_NAME_LENGTH}
            placeholder={tab.title}
            aria-label="Name this tab"
            spellcheck="false"
            autocomplete="off"
            onkeydown={onNameKey}
            onblur={() => finishRename(true)}
            class="border-border-control bg-bg rounded border px-1 py-0.5 font-mono text-xs"
          />
        </div>
      {:else}
        <button
          type="button"
          role="tab"
          id="request-tab-{tab.id}"
          aria-selected={selected}
          aria-controls={panelId}
          tabindex={selected ? 0 : -1}
          title="{tab.title}. Drag, or Shift and an arrow key, to move it. Double-click or F2 renames it; Delete or a middle click closes it."
          draggable="true"
          use:remember={tab.id}
          ondragstart={(event) => onDragStart(event, tab)}
          ondragover={(event) => onDragOver(event, tab)}
          ondrop={onDrop}
          ondragend={endDrag}
          onclick={() => requestTabs.select(tab.id)}
          ondblclick={() => startRename(tab)}
          onauxclick={(event) => {
            if (event.button === 1) close(tab);
          }}
          onkeydown={(event) => onTabKey(event, index)}
          class="group flex max-w-60 min-w-32 shrink-0 items-start gap-2 border-b-2 px-3 py-1.5 text-left
            {selected
            ? 'border-primary bg-surface text-fg'
            : 'text-fg-muted hover:text-fg border-transparent'}
            {dragging === tab.id ? 'opacity-50' : ''}
            {dropAt?.id === tab.id
            ? dropAt.after
              ? 'shadow-[inset_-2px_0_0_var(--color-primary)]'
              : 'shadow-[inset_2px_0_0_var(--color-primary)]'
            : ''}"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[11px]" data-testid="request-tab-environment">
              {environmentName(tab.environmentId)}
            </span>
            <span class="block truncate font-mono text-xs" data-testid="request-tab-title">
              {tab.title}
            </span>
          </span>
          {#if tab.loading}
            <span class="bg-primary mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"></span>
            <span class="sr-only">(sending)</span>
          {/if}
          <!-- A pointer shortcut only: from the keyboard, Delete closes the
               focused tab, and a button inside a tab is not allowed. -->
          <span
            aria-hidden="true"
            data-testid="request-tab-close"
            class="hover:bg-surface-2 hover:text-fg -mr-1 shrink-0 rounded px-1 leading-none
              {selected ? '' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}"
            onclick={(event) => {
              event.stopPropagation();
              close(tab);
            }}
          >
            &times;
          </span>
        </button>
      {/if}
    {/each}
  </div>

  {#if requestTabs.full}
    <button
      type="button"
      disabled
      title="At most {MAX_REQUEST_TABS} tabs are open at once. Close one to open another."
      class="{NEW_TAB_CLASS} opacity-50"
    >
      + New tab
    </button>
  {:else if config.environments.length === 1}
    <button
      type="button"
      class={NEW_TAB_CLASS}
      onclick={() => {
        requestTabs.open(config.activeEnvironmentId);
        focusTab(requestTabs.selected?.id);
      }}
    >
      + New tab
    </button>
  {:else}
    <MenuButton
      label="+ New tab"
      items={config.environments.map((env) => ({
        label: env.name,
        onselect: () => {
          requestTabs.open(env.id);
          focusTab(requestTabs.selected?.id);
        }
      }))}
      class={NEW_TAB_CLASS}
    />
  {/if}
</div>
