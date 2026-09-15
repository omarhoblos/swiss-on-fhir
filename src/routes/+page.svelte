<script lang="ts">
  import { config } from '$lib/config/config.svelte';
  import Alert from '$lib/components/ui/Alert.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import SourceBadge from '$lib/components/ui/SourceBadge.svelte';

  const summary = $derived([
    { key: 'fhirBaseUrl' as const, label: 'FHIR base' },
    { key: 'authIssuer' as const, label: 'Authorization server' },
    { key: 'clientId' as const, label: 'Client ID' }
  ]);
</script>

<div class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">Session &amp; Tokens</h1>
    <p class="text-fg-muted mt-1 text-sm">
      Inspect the tokens, launch context and granted scopes for the current session.
    </p>
  </header>

  {#if config.loadError}
    <Alert severity="error" title="Runtime configuration could not be loaded">
      <p>{config.loadError}</p>
      <p class="mt-2">
        Running on built-in defaults. <a class="underline" href="/config">Open Configuration</a> to set
        values for this browser.
      </p>
    </Alert>
  {/if}

  <Card title="Effective configuration" subtitle="What a launch would use right now.">
    {#snippet actions()}
      <a href="/config" class="text-primary text-xs hover:underline">Edit</a>
    {/snippet}

    <dl class="space-y-2">
      {#each summary as row (row.key)}
        <div class="flex flex-wrap items-baseline gap-2">
          <dt class="text-fg-muted w-44 shrink-0 text-xs">{row.label}</dt>
          <dd class="font-mono text-sm">{config.current[row.key] || '—'}</dd>
          <SourceBadge source={config.sourceOf(row.key)} />
        </div>
      {/each}
      <div class="flex flex-wrap items-baseline gap-2">
        <dt class="text-fg-muted w-44 shrink-0 text-xs">Redirect URI</dt>
        <dd class="font-mono text-sm">{config.redirectUri}</dd>
        <span class="text-fg-muted text-[10px] italic">derived</span>
      </div>
      <div class="flex flex-wrap items-baseline gap-2">
        <dt class="text-fg-muted w-44 shrink-0 text-xs">Scopes</dt>
        <dd class="font-mono text-xs">{config.current.scopes}</dd>
        <SourceBadge source={config.sourceOf('scopes')} />
      </div>
    </dl>

    {#if config.overriddenKeys.length > 0}
      <p class="text-warning mt-3 text-xs">
        {config.overriddenKeys.length} setting(s) overridden in this browser.
      </p>
    {/if}
  </Card>

  <Card title="No active session">
    <p class="text-fg-muted text-sm">No access token yet. Start a launch to obtain one.</p>
    <a
      href="/launch"
      class="bg-primary mt-3 inline-block rounded-md px-3 py-1.5 text-sm font-medium text-white"
    >
      Go to Launch
    </a>
  </Card>
</div>
