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
  import { parseBlocks, parseInline, type Inline } from '$lib/markdown';

  /**
   * Check text, which is written as Markdown for the downloaded report.
   * `inline` is for places that cannot hold block elements, like <summary>.
   */
  let { text, inline = false }: { text: string; inline?: boolean } = $props();

  const blocks = $derived(inline ? [] : parseBlocks(text));
  const spans = $derived(inline ? parseInline(text) : []);

  // One element per token, written without whitespace between them: Svelte
  // turns any gap between tags into a visible space before punctuation.
  const TAGS: Record<Inline['kind'], string> = {
    text: 'span',
    code: 'code',
    strong: 'strong',
    em: 'em'
  };
  const CLASSES: Record<Inline['kind'], string> = {
    text: '',
    code: 'bg-surface-2 rounded px-1 font-mono text-[0.95em]',
    strong: 'text-fg font-semibold',
    em: ''
  };
</script>

{#snippet line(tokens: Inline[])}{#each tokens as token, i (i)}<svelte:element
      this={TAGS[token.kind]}
      class={CLASSES[token.kind]}>{token.value}</svelte:element
    >{/each}{/snippet}

{#if inline}
  {@render line(spans)}
{:else}
  <div class="space-y-2">
    {#each blocks as block, b (b)}
      {#if block.kind === 'list'}
        <ul class="list-outside list-disc space-y-0.5 pl-4">
          {#each block.items as item, i (i)}
            <li>{@render line(item)}</li>
          {/each}
        </ul>
      {:else}
        <p>
          {#each block.lines as tokens, i (i)}{#if i > 0}<br />{/if}{@render line(tokens)}{/each}
        </p>
      {/if}
    {/each}
  </div>
{/if}
