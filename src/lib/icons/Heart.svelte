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
  let { class: klass = 'h-4 w-4' }: { class?: string } = $props();
</script>

<svg class={klass} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path
    d="M12 21s-7.5-4.6-9.3-9A5.2 5.2 0 0 1 12 6.2 5.2 5.2 0 0 1 21.3 12c-1.8 4.4-9.3 9-9.3 9z"
  />
</svg>
