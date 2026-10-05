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

  /**
   * A diagram on the Swiss on FHIR Documentation page with the sentence that says what
   * it shows. The drawing scrolls inside its own frame on a narrow screen, so
   * the page itself never scrolls sideways.
   */
  let { caption, children }: { caption: Snippet; children: Snippet } = $props();
</script>

<figure class="my-5">
  <div class="border-border bg-surface overflow-x-auto rounded-lg border p-3">
    {@render children()}
  </div>
  <figcaption class="text-fg-muted mt-2.5 max-w-3xl text-sm">{@render caption()}</figcaption>
</figure>
