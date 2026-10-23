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
  import { tab } from '#lib/tabs.svelte.ts';
  import { MAX_TAB_LABEL_LENGTH } from '#lib/tab-label.ts';

  /**
   * This browser tab's name, in the bar on every page. Double-click it (or
   * focus it and press Enter or F2) to type a label of up to 64 characters,
   * so several Swiss tabs can be told apart here, in the browser's own tab
   * strip, and beside each entry in the exchange log's "All tabs" view. An
   * empty label goes back to the default.
   */
  let editing = $state(false);
  let draft = $state('');

  function start() {
    draft = tab.label;
    editing = true;
  }

  function save() {
    if (!editing) return;
    tab.setLabel(draft);
    editing = false;
  }

  function cancel() {
    editing = false;
  }

  function focusAndSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

{#if editing}
  <input
    type="text"
    bind:value={draft}
    maxlength={MAX_TAB_LABEL_LENGTH}
    aria-label="Name this tab"
    placeholder={`Tab ${tab.id.slice(0, 4)}`}
    spellcheck="false"
    autocomplete="off"
    class="border-border-control bg-bg w-44 rounded border px-2 py-0.5 text-[11px]"
    use:focusAndSelect
    onkeydown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    }}
    onblur={save}
  />
{:else}
  <button
    type="button"
    data-testid="tab-label"
    title="Double-click to rename this tab"
    aria-label={`This tab: ${tab.displayLabel}. Press Enter to rename it.`}
    class="border-border-control text-fg-muted hover:text-fg max-w-44 truncate rounded border px-2 py-0.5 text-[11px] whitespace-nowrap"
    ondblclick={start}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === 'F2') {
        event.preventDefault();
        start();
      }
    }}
  >
    {tab.displayLabel}
  </button>
{/if}
