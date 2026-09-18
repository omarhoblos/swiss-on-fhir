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
  import type { ConfigSource } from '$lib/config/types';

  let { source }: { source: ConfigSource } = $props();

  // The most useful thing the config page can tell you: is this value coming
  // from my .env, or from something I typed in this browser weeks ago?
  const meta: Record<ConfigSource, { label: string; class: string; title: string }> = {
    default: {
      label: 'default',
      class: 'border-border text-fg-muted',
      title: 'Built-in default; neither .env nor a live edit set this.'
    },
    runtime: {
      label: 'from .env',
      class: 'border-info/50 text-info',
      title: 'Supplied by the deployment, via .env -> static/swiss-env.json.'
    },
    override: {
      label: 'edited here',
      class: 'border-warning/50 text-warning',
      title: 'Overridden live in this browser, stored in localStorage. Reset to fall back to .env.'
    },
    launch: {
      label: 'from EHR launch',
      class: 'border-secondary/50 text-secondary',
      title: 'Supplied by the EHR launch (iss) for this session only; not saved.'
    }
  };
</script>

<span
  class="rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-tight {meta[source].class}"
  title={meta[source].title}
>
  {meta[source].label}
</span>
