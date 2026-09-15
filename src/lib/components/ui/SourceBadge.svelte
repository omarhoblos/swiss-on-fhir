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
