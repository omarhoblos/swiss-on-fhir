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
  import XmlTree from './XmlTree.svelte';
  import { copyToClipboard } from '$lib/clipboard';
  import { childPath, ROOT_PATH, type JsonSearch } from '$lib/fhir/search';
  import { xmlNodeText } from '$lib/fhir/xml-tree';
  import type { XmlNode } from '$lib/fhir/xml';

  /**
   * Collapsible XML tree, the XML counterpart of JsonTree and built the same
   * way: children render only while their element is open, `depth` levels
   * open by default, and with `search` only the branches leading to a match
   * are shown, opened down to it.
   *
   * An element with no children -- most of FHIR XML, `<id value="x"/>` --
   * and one holding only text are a single row. Element names take the
   * colour of JSON keys, attribute values that of JSON strings.
   */
  let {
    node,
    depth = 2,
    path = ROOT_PATH,
    level = 0,
    search
  }: {
    node: XmlNode;
    depth?: number;
    path?: string;
    level?: number;
    search?: JsonSearch;
  } = $props();

  const element = $derived(node.kind === 'element' ? node : null);
  const only = $derived(element?.children.length === 1 ? element.children[0] : undefined);
  /** One row: no children, or only text. */
  const inline = $derived(
    element !== null && (element.children.length === 0 || only?.kind === 'text')
  );

  const entries = $derived(
    (element?.children ?? []).map((child, i) => ({ key: String(i), node: child }))
  );
  const childAt = (key: string) => childPath(path, key, true);

  const isHit = $derived(search?.hits.has(path) ?? false);
  const leadsToHit = $derived(
    search ? entries.some((entry) => search.paths.has(childAt(entry.key))) : false
  );
  const shown = $derived(
    !search || isHit ? entries : entries.filter((entry) => search.paths.has(childAt(entry.key)))
  );

  let expandedOverride = $state<boolean | null>(null);
  const expanded = $derived(expandedOverride ?? (search ? leadsToHit : level < depth));

  let copied = $state(false);
  async function copySubtree(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    copied = await copyToClipboard(xmlNodeText(node));
    setTimeout(() => (copied = false), 1200);
  }
</script>

{#snippet tag(close: boolean)}
  {#if element}
    <span class="text-fg-muted">&lt;</span><span class="text-json-key">{element.name}</span
    >{#each element.attributes as [name, value] (name)}
      <span class="text-fg-muted">{` ${name}=`}</span><span class="text-json-string">"{value}"</span
      >{/each}<span class="text-fg-muted">{close ? '/>' : '>'}</span>
  {/if}
{/snippet}

{#if element && !inline}
  <div class="font-mono text-xs">
    <button
      type="button"
      class="hover:bg-surface-2/50 group flex w-full items-start gap-1 rounded px-1 text-left"
      onclick={() => (expandedOverride = !expanded)}
      aria-expanded={expanded}
    >
      <span class="text-fg-muted w-3 shrink-0 select-none">{expanded ? '−' : '+'}</span>
      <span class="min-w-0 break-all">{@render tag(false)}</span>
      {#if !expanded}
        <span class="text-fg-muted shrink-0">{`{${entries.length}}`}</span>
      {/if}
      <span
        role="button"
        tabindex="-1"
        class="text-fg-muted hover:text-fg ml-auto hidden shrink-0 px-1 group-hover:inline"
        title="Copy this element"
        onclick={copySubtree}
        onkeydown={(e) => e.key === 'Enter' && copySubtree(e as unknown as MouseEvent)}
      >
        {copied ? 'copied' : 'copy'}
      </span>
    </button>

    {#if expanded}
      <div class="border-border/40 ml-3 border-l pl-2">
        {#each shown as entry (entry.key)}
          <XmlTree
            node={entry.node}
            {depth}
            path={childAt(entry.key)}
            level={level + 1}
            search={search?.paths.has(childAt(entry.key)) ? search : undefined}
          />
        {/each}
      </div>
    {/if}
  </div>
{:else if element}
  <div class="flex gap-1 px-1 font-mono text-xs">
    <span class="w-3 shrink-0"></span>
    <span class="min-w-0 break-all">
      {#if only?.kind === 'text'}
        {@render tag(false)}<span class="text-fg">{only.text}</span><span class="text-fg-muted"
          >&lt;/</span
        ><span class="text-json-key">{element.name}</span><span class="text-fg-muted">&gt;</span>
      {:else}
        {@render tag(true)}
      {/if}
    </span>
  </div>
{:else if node.kind === 'text'}
  <div class="flex gap-1 px-1 font-mono text-xs">
    <span class="w-3 shrink-0"></span>
    <span class="text-fg min-w-0 break-all">{node.text}</span>
  </div>
{:else if node.kind === 'comment'}
  <div class="flex gap-1 px-1 font-mono text-xs">
    <span class="w-3 shrink-0"></span>
    <span class="text-fg-muted min-w-0 break-all italic">&lt;!--{node.text}--&gt;</span>
  </div>
{/if}
