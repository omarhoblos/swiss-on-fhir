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
  import { ALL_CHECKS } from '$lib/diagnostics/checks';
  import { GROUP_LABELS } from '$lib/diagnostics/groups';
  import type { CheckGroup } from '$lib/diagnostics/types';

  /**
   * The order Diagnostics runs in, drawn from ALL_CHECKS so it cannot drift
   * from the code: the groups in the order their checks run, then the manual
   * checks, which run last whatever group they are filed under. The second
   * row is a real dependency, the first check that declares one.
   */
  const SUBTITLE: Record<CheckGroup | 'manual', string> = {
    environment: 'no network needed',
    discovery: 'documents load?',
    capabilities: 'request supported?',
    cors: 'page can reach it?',
    flow: 'needs a session',
    permissions: 'needs a session',
    manual: 'explain what to check'
  };
  const BOX: Record<CheckGroup | 'manual', { box: string; text: string }> = {
    environment: { box: 'box-a', text: 'ta' },
    discovery: { box: 'box-e', text: 'te' },
    capabilities: { box: 'box-e', text: 'te' },
    cors: { box: 'box-e', text: 'te' },
    flow: { box: 'box-s', text: 'ts' },
    permissions: { box: 'box-s', text: 'ts' },
    manual: { box: 'box', text: '' }
  };

  // The groups' titles from the Diagnostics page, shortened where one would
  // not fit its box.
  const SHORT_TITLE: Partial<Record<CheckGroup, string>> = { cors: 'Cross-origin' };

  const isManual = (id: string) => id.startsWith('manual.');
  const automatic = ALL_CHECKS.filter((check) => !isManual(check.id));
  const stages = [
    ...[...new Set(automatic.map((check) => check.group))].map((group) => ({
      key: group as CheckGroup | 'manual',
      title: SHORT_TITLE[group] ?? GROUP_LABELS[group].title,
      count: automatic.filter((check) => check.group === group).length
    })),
    {
      key: 'manual' as const,
      title: 'Manual',
      count: ALL_CHECKS.filter((check) => isManual(check.id)).length
    }
  ].filter((stage) => stage.count > 0);

  const example = ALL_CHECKS.find((check) => check.dependsOn?.length);

  const WIDTH = 940;
  const GAP = 22;
  const boxWidth = (WIDTH - 32 - GAP * (stages.length - 1)) / stages.length;
  const x = (i: number) => 16 + i * (boxWidth + GAP);

  const label = `Diagnostics runs its checks in a fixed order: ${stages
    .map((stage) => stage.title)
    .join(', then ')}. A check that depends on another is skipped, by name, when that one fails${
    example ? `, for example ${example.id} needs ${example.dependsOn![0]}` : ''
  }.`;
</script>

<svg
  class="dg block h-auto w-full min-w-[720px]"
  viewBox="0 0 {WIDTH} {example ? 222 : 120}"
  role="img"
  aria-label={label}
>
  <defs>
    <marker
      id="s8a"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="ha" d="M0 0 L10 5 L0 10 z" /></marker
    >
    <marker
      id="s8m"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="hm" d="M0 0 L10 5 L0 10 z" /></marker
    >
  </defs>

  {#each stages as stage, i (stage.key)}
    <rect
      class="{BOX[stage.key].box} {stage.key === 'manual' ? 'dash' : ''}"
      x={x(i)}
      y="24"
      width={boxWidth}
      height="72"
      rx="6"
    />
    <text class="t {BOX[stage.key].text}" x={x(i) + boxWidth / 2} y="48" text-anchor="middle"
      >{stage.title}</text
    >
    <text class="m" x={x(i) + boxWidth / 2} y="66" text-anchor="middle">{SUBTITLE[stage.key]}</text>
    <text class="cs" x={x(i) + boxWidth / 2} y="84" text-anchor="middle"
      >{stage.count} {stage.count === 1 ? 'check' : 'checks'}</text
    >
    {#if i < stages.length - 1}
      <path class="la" d="M{x(i) + boxWidth} 60 H{x(i + 1) - 4}" marker-end="url(#s8a)" />
    {/if}
  {/each}

  {#if example}
    <text class="t" x="16" y="160">When a check fails,</text>
    <text class="m" x="16" y="178">the checks that need it</text>
    <text class="m" x="16" y="194">are skipped, by name</text>

    <rect class="box" x="200" y="140" width="290" height="62" rx="6" />
    <text class="c" x="345" y="166" text-anchor="middle">{example.dependsOn![0]}</text>
    <text class="m" x="345" y="186" text-anchor="middle">fails</text>

    <path class="ln dash" d="M490 171 H556" marker-end="url(#s8m)" />
    <text class="m" x="523" y="162" text-anchor="middle">needed by</text>

    <rect class="box dash" x="560" y="140" width="364" height="62" rx="6" />
    <text class="c" x="742" y="166" text-anchor="middle">{example.id}</text>
    <text class="m" x="742" y="186" text-anchor="middle"
      >skipped: needs {example.dependsOn![0]}</text
    >
  {/if}
</svg>
