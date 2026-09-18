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
  /**
   * A small busy indicator for page titles. `label` is announced to screen
   * readers, so it says what is in progress rather than just "loading".
   */
  let { label, class: klass = 'h-5 w-5' }: { label: string; class?: string } = $props();
</script>

<span role="status" class="text-primary inline-flex items-center">
  <svg
    class="{klass} motion-safe:animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" class="opacity-25" />
    <path d="M21 12a9 9 0 0 0-9-9" />
  </svg>
  <span class="sr-only">{label}</span>
</span>
