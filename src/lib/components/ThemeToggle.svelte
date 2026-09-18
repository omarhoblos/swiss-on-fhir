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
  import { theme } from '$lib/theme.svelte';
  import Sun from '$lib/icons/Sun.svelte';
  import Moon from '$lib/icons/Moon.svelte';
</script>

<button
  type="button"
  onclick={() => theme.toggle()}
  class="text-fg-muted hover:text-fg hover:bg-surface-2 rounded p-2 transition-colors"
  aria-label={theme.isLight ? 'Switch to dark theme' : 'Switch to light theme'}
  title={theme.isLight ? 'Switch to dark theme' : 'Switch to light theme'}
>
  {#if theme.isLight}
    <Moon />
  {:else}
    <Sun />
  {/if}
</button>
