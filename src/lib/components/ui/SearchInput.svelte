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
  import Close from '$lib/icons/Close.svelte';

  /**
   * A search box with its own clear button, which appears once there is
   * something to clear. Clearing empties the box and leaves focus in it for
   * the next search. The browser's own clear button is hidden: Firefox draws
   * none, so ours is the one every reader gets.
   */
  let {
    value = $bindable(''),
    label,
    placeholder,
    describedby,
    onkeydown
  }: {
    value?: string;
    label: string;
    placeholder?: string;
    describedby?: string;
    onkeydown?: (event: KeyboardEvent) => void;
  } = $props();

  let input = $state<HTMLInputElement>();

  function clear() {
    value = '';
    input?.focus();
  }
</script>

<div class="relative">
  <input
    bind:this={input}
    bind:value
    {onkeydown}
    type="search"
    aria-label={label}
    aria-describedby={describedby}
    {placeholder}
    autocomplete="off"
    class="search bg-bg border-border-control w-full rounded border py-1.5 pr-8 pl-2 text-sm"
  />
  {#if value}
    <button
      type="button"
      onclick={clear}
      aria-label="Clear search"
      title="Clear search"
      class="text-fg-muted hover:text-fg hover:bg-surface-2 absolute inset-y-0 right-1 my-auto h-6 rounded p-1"
    >
      <Close class="h-4 w-4" />
    </button>
  {/if}
</div>

<style>
  .search::-webkit-search-cancel-button {
    appearance: none;
  }
</style>
