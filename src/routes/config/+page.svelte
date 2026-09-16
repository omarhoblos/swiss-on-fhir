<script lang="ts">
  import { config } from '$lib/config/config.svelte';
  import { ENV_BACKED_FIELDS, FIELDS } from '$lib/config/fields';
  import ConfigField from '$lib/components/ConfigField.svelte';
  import Alert from '$lib/components/ui/Alert.svelte';
  import Card from '$lib/components/ui/Card.svelte';

  const envFields = ENV_BACKED_FIELDS;
  const appFields = FIELDS.filter((f) => f.envKey === null);

  let importText = $state('');
  let importResult = $state<{ ok: boolean; errors: string[]; applied: number } | null>(null);
  let includeSecretInExport = $state(false);
  let copied = $state<string | null>(null);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = label;
      setTimeout(() => (copied = null), 1500);
    } catch {
      copied = null;
    }
  }

  function runImport() {
    importResult = config.import(importText);
    if (importResult.ok) importText = '';
  }
</script>

<div class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">Configuration</h1>
    <p class="text-fg-muted mt-1 text-sm">
      Values come from <code class="font-mono text-xs">.env</code> at startup and can be overridden
      live here. Overrides are stored in this browser and layer on top of the deployment&rsquo;s
      values &mdash; they never change <code class="font-mono text-xs">.env</code> itself.
    </p>
  </header>

  {#if config.loadError}
    <Alert severity="error" title="The runtime configuration file could not be loaded">
      <p>{config.loadError}</p>
      <p class="mt-2">
        Swiss is running on its built-in defaults. You can still set everything below, but the
        deployment&rsquo;s <code class="font-mono text-xs">.env</code> is not being applied.
      </p>
    </Alert>
  {/if}

  {#if config.launchInfo}
    <Alert severity="info" title="FHIR base URL overridden by an EHR launch">
      <p>
        This session is using <code class="font-mono text-xs">{config.launchInfo.fhirBaseUrl}</code
        >, supplied by the EHR as the <code class="font-mono text-xs">iss</code> launch parameter.
        {#if config.launchInfo.overriddenFhirBaseUrl}
          Your configured value
          <code class="font-mono text-xs">{config.launchInfo.overriddenFhirBaseUrl}</code> is not being
          used.
        {/if}
        This is not saved.
      </p>
    </Alert>
  {/if}

  {#each config.errors as issue (issue.message)}
    <Alert severity="error">{issue.message}</Alert>
  {/each}

  <Card
    title="Deployment settings"
    subtitle="These six come from .env. Note that any keys not listed here from older versions have been depricated."
  >
    {#each envFields as spec (spec.key)}
      <ConfigField {spec} />
    {/each}
  </Card>

  <Card title="Redirect URI" subtitle="Derived from the current origin; not configurable.">
    <div class="flex flex-wrap items-center gap-2">
      <code class="bg-bg border-border rounded border px-2 py-1 font-mono text-sm">
        {config.redirectUri}
      </code>
      <button
        type="button"
        class="border-border text-fg-muted hover:text-fg rounded-md border px-2 py-1 text-xs"
        onclick={() => copy(config.redirectUri, 'redirect')}
      >
        {copied === 'redirect' ? 'Copied' : 'Copy'}
      </button>
    </div>
    <p class="text-fg-muted mt-2 text-xs">
      Register this exact string with your client. Swiss 2.x plumbed a configurable
      <code class="font-mono">REDIRECT_URI</code> and then ignored it, using the bare origin while
      the README told you to register <code class="font-mono">/index.html</code> &mdash; so
      registrations exist both ways. A callback arriving at
      <code class="font-mono">/</code>, <code class="font-mono">/index.html</code> or any path
      carrying <code class="font-mono">code</code> is still handled, so an existing registration keeps
      working.
    </p>
  </Card>

  <Card title="Testing options" subtitle="In-app only. Per-experiment, not per-deployment.">
    {#each appFields as spec (spec.key)}
      <ConfigField {spec} />
    {/each}
  </Card>

  {#if config.warnings.length > 0}
    <Card title="Warnings" subtitle="Swiss will still run. These are things worth knowing.">
      <ul class="space-y-2">
        {#each config.warnings as issue (issue.message)}
          <li class="text-warning text-xs">{issue.message}</li>
        {/each}
      </ul>
    </Card>
  {/if}

  {#if config.ignoredKeys.length > 0}
    <Card
      title="Ignored settings"
      subtitle="Recognised, parsed, and not used. Your .env does not need changing."
    >
      <ul class="space-y-2">
        {#each config.ignoredKeys as issue (issue.ignoredKey)}
          <li class="text-fg-muted text-xs">
            <code class="font-mono">{issue.ignoredKey}</code> &mdash; {issue.message}
          </li>
        {/each}
      </ul>
    </Card>
  {/if}

  <Card title="Export and import">
    {#snippet actions()}
      <button
        type="button"
        class="border-border text-fg-muted hover:text-fg rounded-md border px-2 py-1 text-xs"
        onclick={() => config.resetAll()}
        disabled={config.overriddenKeys.length === 0}
      >
        Reset all overrides ({config.overriddenKeys.length})
      </button>
    {/snippet}

    <div class="space-y-4">
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="bg-primary rounded-md px-2.5 py-1 text-xs font-medium text-white"
            onclick={() => copy(config.export({ includeSecret: includeSecretInExport }), 'json')}
          >
            {copied === 'json' ? 'Copied' : 'Copy as JSON'}
          </button>
          <button
            type="button"
            class="border-border text-fg-muted hover:text-fg rounded-md border px-2.5 py-1 text-xs"
            onclick={() => copy(config.toDotEnv(), 'env')}
          >
            {copied === 'env' ? 'Copied' : 'Copy as .env'}
          </button>
          <label class="text-fg-muted flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              bind:checked={includeSecretInExport}
              class="accent-primary h-3.5 w-3.5"
            />
            Include client secret
          </label>
        </div>
        {#if includeSecretInExport && config.current.clientSecret}
          <p class="text-warning mt-1.5 text-xs">
            The export will contain your live client secret in plaintext.
          </p>
        {/if}
      </div>

      <div>
        <label for="config-import" class="text-sm font-medium">Import JSON</label>
        <p class="text-fg-muted mt-0.5 mb-1.5 text-xs">
          Applied as live overrides, so &ldquo;Reset all&rdquo; still returns you to the
          deployment&rsquo;s <code class="font-mono">.env</code>. Rejected in full if any value
          fails to parse.
        </p>
        <textarea
          id="config-import"
          bind:value={importText}
          rows="4"
          spellcheck="false"
          placeholder={'{\n  "authIssuer": "https://idp.example"\n}'}
          class="border-border bg-bg w-full rounded-md border px-2 py-1.5 font-mono text-xs"
        ></textarea>
        <button
          type="button"
          class="bg-primary mt-2 rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
          onclick={runImport}
          disabled={importText.trim() === ''}
        >
          Import
        </button>
        {#if importResult}
          <div class="mt-2">
            {#if importResult.ok}
              <Alert severity="info">Applied {importResult.applied} setting(s).</Alert>
            {:else}
              <Alert severity="error" title="Nothing was imported">
                <ul class="list-inside list-disc">
                  {#each importResult.errors as e (e)}
                    <li>{e}</li>
                  {/each}
                </ul>
              </Alert>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </Card>

  <Card title="Session fingerprint" subtitle="Identifies the auth-critical settings in effect.">
    <code class="text-fg-muted font-mono text-[11px] break-all">{config.fingerprint}</code>
    <p class="text-fg-muted mt-2 text-xs">
      Stored alongside a session so Swiss can tell you when tokens were issued under different
      settings, rather than silently showing tokens from one server as if they belonged to another.
      The client secret contributes only whether it is set, never its value.
    </p>
  </Card>
</div>
