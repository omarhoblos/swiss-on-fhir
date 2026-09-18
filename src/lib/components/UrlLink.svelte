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
  import { httpUrl } from '$lib/url';

  /**
   * A URL Swiss is displaying, linked when it can be.
   *
   * Opening a URL in a new tab is one of the few things that definitively
   * resolves a CORS failure -- if it loads there and not here, it is CORS and
   * nothing else -- so every URL on screen is worth making clickable.
   *
   * `stopPropagation` because these appear inside <summary>: a link is the
   * activation target in preference to the summary, but stopping the click
   * keeps any surrounding toggle handler out of it too.
   */
  let {
    value,
    class: className = 'text-primary underline underline-offset-2'
  }: { value: string; class?: string } = $props();

  const href = $derived(httpUrl(value));
</script>

{#if href}
  <a
    {href}
    target="_blank"
    rel="noopener noreferrer"
    class={className}
    onclick={(event) => event.stopPropagation()}>{value}</a
  >
{:else}
  {value}
{/if}
