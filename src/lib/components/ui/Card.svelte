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
    children
  }: { title?: string; subtitle?: string; actions?: Snippet; children?: Snippet } = $props();
</script>

<section class="border-border bg-surface rounded-lg border">
  {#if title || actions}
    <header class="border-border flex items-start justify-between gap-4 border-b px-4 py-3">
      <div>
        {#if title}<h2 class="font-semibold">{title}</h2>{/if}
        {#if subtitle}<p class="text-fg-muted mt-0.5 text-xs">{subtitle}</p>{/if}
      </div>
      {#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
    </header>
  {/if}
  <div class="px-4 py-3">
    {@render children?.()}
  </div>
</section>
