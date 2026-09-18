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
  import type { Severity } from '$lib/config/types';
  import type { Snippet } from 'svelte';

  let {
    severity = 'error',
    title,
    children
  }: { severity?: Severity; title?: string; children?: Snippet } = $props();

  const styles: Record<Severity, string> = {
    error: 'border-error/50 bg-error/10 text-error',
    warning: 'border-warning/50 bg-warning/10 text-warning',
    info: 'border-info/50 bg-info/10 text-info'
  };
</script>

<div
  class="rounded-md border px-3 py-2 text-sm {styles[severity]}"
  role={severity === 'error' ? 'alert' : 'status'}
>
  {#if title}
    <p class="font-semibold">{title}</p>
  {/if}
  <div class="text-fg/90 [&:not(:first-child)]:mt-1">
    {@render children?.()}
  </div>
</div>
