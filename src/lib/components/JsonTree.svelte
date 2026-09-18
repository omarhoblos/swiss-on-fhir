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
  import JsonTree from './JsonTree.svelte';
  import { copyToClipboard } from '$lib/clipboard';

  /**
   * Collapsible JSON tree, replacing ngx-json-viewer.
   *
   * The important difference: children are rendered only when the node is
   * expanded. ngx-json-viewer built the entire tree and hid it with CSS,
   * which is what made a Patient/$everything bundle crawl. Self-imports by
   * filename because Svelte 5 removed <svelte:self>.
   */
  let {
    value,
    name,
    depth = 2,
    path = '$',
    level = 0
  }: {
    value: unknown;
    name?: string;
    /** Levels expanded by default. Matches the old viewer's depth={2}. */
    depth?: number;
    path?: string;
    level?: number;
  } = $props();

  let expandedOverride = $state<boolean | null>(null);
  const expanded = $derived(expandedOverride ?? level < depth);

  const kind = $derived(
    value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : typeof value === 'object'
          ? 'object'
          : typeof value
  );

  const isBranch = $derived(kind === 'array' || kind === 'object');

  const entries = $derived(
    kind === 'array'
      ? (value as unknown[]).map((v, i) => ({ key: String(i), value: v }))
      : kind === 'object'
        ? Object.entries(value as Record<string, unknown>).map(([key, v]) => ({ key, value: v }))
        : []
  );

  const preview = $derived(
    kind === 'array' ? `[${entries.length}]` : kind === 'object' ? `{${entries.length}}` : ''
  );

  let copied = $state(false);
  async function copySubtree(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    copied = await copyToClipboard(JSON.stringify(value, null, 2));
    setTimeout(() => (copied = false), 1200);
  }

  const childPath = (key: string) => (kind === 'array' ? `${path}[${key}]` : `${path}.${key}`);

  function scalarClass(k: string): string {
    if (k === 'string') return 'text-json-string';
    if (k === 'number' || k === 'bigint') return 'text-json-number';
    return 'text-fg-muted';
  }

  function renderScalar(v: unknown, k: string): string {
    if (k === 'string') return `"${String(v)}"`;
    return String(v);
  }
</script>

{#if isBranch}
  <div class="font-mono text-xs">
    <button
      type="button"
      class="hover:bg-surface-2/50 group flex w-full items-center gap-1 rounded px-1 text-left"
      onclick={() => (expandedOverride = !expanded)}
      aria-expanded={expanded}
    >
      <span class="text-fg-muted w-3 shrink-0 select-none">{expanded ? '−' : '+'}</span>
      {#if name !== undefined}
        <span class="text-json-key">{name}</span><span class="text-fg-muted">:</span>
      {/if}
      <span class="text-fg-muted">{preview}</span>
      <span
        role="button"
        tabindex="-1"
        class="text-fg-muted hover:text-fg ml-auto hidden px-1 group-hover:inline"
        title="Copy this subtree"
        onclick={copySubtree}
        onkeydown={(e) => e.key === 'Enter' && copySubtree(e as unknown as MouseEvent)}
      >
        {copied ? 'copied' : 'copy'}
      </span>
    </button>

    {#if expanded}
      <div class="border-border/40 ml-3 border-l pl-2">
        {#each entries as entry (entry.key)}
          <JsonTree
            value={entry.value}
            name={entry.key}
            {depth}
            path={childPath(entry.key)}
            level={level + 1}
          />
        {/each}
        {#if entries.length === 0}
          <span class="text-fg-muted italic">empty</span>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <div class="flex gap-1 px-1 font-mono text-xs">
    <span class="w-3 shrink-0"></span>
    {#if name !== undefined}
      <span class="text-json-key">{name}</span><span class="text-fg-muted">:</span>
    {/if}
    <span class={scalarClass(kind)}>{renderScalar(value, kind)}</span>
  </div>
{/if}
