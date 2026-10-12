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

<script lang="ts" generics="T extends string">
  /**
   * Two options in one control: JSON or XML. Both are shown, the current one
   * highlighted, and a click anywhere on it -- or Space or Enter -- flips to
   * the other, so there is no picking the right half to hit.
   *
   * One button whose name carries the current value ("Response format:
   * JSON") and whose title says what a press does. Not `role="switch"`: that
   * reads as on or off, and neither format is "off". The value stays with
   * the caller, since flipping can also mean sending a request.
   */
  let {
    value,
    options,
    label,
    onchange
  }: {
    value: T;
    options: readonly [{ value: T; label: string }, { value: T; label: string }];
    /** What is being chosen, as the start of the button's name. */
    label: string;
    onchange: (value: T) => void;
  } = $props();

  const current = $derived(options.find((o) => o.value === value) ?? options[0]);
  const other = $derived(current === options[0] ? options[1] : options[0]);
</script>

<button
  type="button"
  aria-label="{label}: {current.label}"
  title="Switch to {other.label}"
  onclick={() => onchange(other.value)}
  class="border-border-control hover:border-fg-muted inline-flex rounded border text-xs"
>
  {#each options as option (option.value)}
    <span
      aria-hidden="true"
      class="px-2 py-1 first:rounded-l last:rounded-r {option.value === value
        ? 'bg-primary text-on-primary font-medium'
        : 'text-fg-muted'}"
    >
      {option.label}
    </span>
  {/each}
</button>
