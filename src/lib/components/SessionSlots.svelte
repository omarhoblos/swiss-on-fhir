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
  import { session } from '#lib/auth/session.svelte.ts';
  import { LAUNCH_TYPES, type LaunchType } from '#lib/environments/types.ts';

  /**
   * Which of the environment's three sessions the page shows. Each launch
   * type keeps its own tokens, so a Backend Services token sits beside a
   * standalone one instead of replacing it. A dot marks a slot that holds
   * tokens.
   */
  const LABELS: Record<LaunchType, string> = {
    standalone: 'Standalone',
    ehr: 'EHR launch',
    'backend-services': 'Backend services'
  };
</script>

<div class="flex flex-wrap items-center gap-1" role="group" aria-label="Session shown">
  {#each LAUNCH_TYPES as launchType (launchType)}
    {@const held = session.heldSlots.includes(launchType)}
    <button
      type="button"
      aria-pressed={session.slot === launchType}
      data-slot={launchType}
      class="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors
        {session.slot === launchType
        ? 'bg-surface-2 text-primary font-medium'
        : 'text-fg-muted hover:text-fg'}"
      onclick={() => session.selectSlot(launchType)}
    >
      {LABELS[launchType]}
      <span
        class="inline-block size-1.5 rounded-full {held
          ? 'bg-success'
          : 'border-border-control border'}"
        aria-hidden="true"
      ></span>
      <span class="sr-only">{held ? '(holds tokens)' : '(empty)'}</span>
    </button>
  {/each}
</div>
