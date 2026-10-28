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
  import { config } from '#lib/config/config.svelte.ts';
  import { fieldSpec, type FieldSpec } from '#lib/config/fields.ts';
  import type { AppConfig } from '#lib/config/types.ts';
  import { keyPairInfo, type KeyPairInfo } from '#lib/oidc/keys.ts';
  import { formatAbsolute } from '#lib/time.ts';
  import ConfigField from '#lib/components/ConfigField.svelte';
  import EnvironmentsCard from '#lib/components/EnvironmentsCard.svelte';
  import ImportExportCard from '#lib/components/ImportExportCard.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Card from '#lib/components/ui/Card.svelte';
  import CopyButton from '#lib/components/ui/CopyButton.svelte';

  const specs = (keys: (keyof AppConfig)[]) => keys.map(fieldSpec);
  const serverFields = specs(['fhirBaseUrl', 'authIssuer', 'defaultLaunchType']);
  const signInFields = specs(['clientId', 'clientSecret', 'scopes']);
  const backendFields = specs(['backendClientId', 'backendScopes']);
  const testingFields = specs([
    'clientAuthMethod',
    'audMode',
    'scopeSyntax',
    'tokenStorage',
    'redactSecrets'
  ]);

  /** The active environment's Backend Services key, re-read when the environment changes. */
  let backendKey = $state<KeyPairInfo | null>(null);
  $effect(() => {
    const envId = config.activeEnvironmentId;
    void keyPairInfo(envId).then((info) => {
      if (config.activeEnvironmentId === envId) backendKey = info;
    });
  });
</script>

<!-- Resets only the settings in one card; "Reset this environment's edits" under Export and import resets every one. -->
{#snippet resetAll(fields: readonly FieldSpec[], label: string, title: string)}
  {@const edited = fields.filter((f) => config.isOverridden(f.key))}
  <button
    type="button"
    class="border-border-control text-fg-muted hover:text-fg rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
    aria-label={label}
    {title}
    onclick={() => edited.forEach((f) => config.resetField(f.key))}
    disabled={edited.length === 0}
  >
    Reset All
  </button>
{/snippet}

<div class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">Configuration</h1>
    <p class="text-fg-muted mt-1 text-sm">
      The Default environment&rsquo;s values come from <code class="font-mono text-xs">.env</code>
      at startup. Every environment can be edited live here; edits are stored in this browser and layer
      on top of the environment&rsquo;s own values &mdash; they never change
      <code class="font-mono text-xs">.env</code> itself.
    </p>
  </header>

  {#if config.environmentNotice}
    <Alert severity="warning">{config.environmentNotice}</Alert>
  {/if}

  {#if config.deploymentIssues.length > 0}
    <Alert severity="warning" title="The deployment's environments file has problems">
      <ul class="list-inside list-disc space-y-0.5">
        {#each config.deploymentIssues as issue, i (i)}
          <li>{issue}</li>
        {/each}
      </ul>
    </Alert>
  {/if}

  {#if config.deploymentServesSecrets || config.deploymentServesKeys}
    <Alert severity="warning" title="The deployment's environments file is served in plaintext">
      <p>
        It carries {config.deploymentServesSecrets && config.deploymentServesKeys
          ? 'client secrets and private keys'
          : config.deploymentServesSecrets
            ? 'client secrets'
            : 'private keys'}, and <code class="font-mono text-xs">/swiss-environments.json</code>
        is readable by anyone who can reach this Swiss, as
        <code class="font-mono text-xs">/swiss-env.json</code> is. Only ship these on a network you control.
      </p>
    </Alert>
  {/if}

  {#if config.loadError}
    <Alert
      severity="error"
      title="The Default environment's runtime configuration file could not be loaded"
    >
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

  {#each config.errors as issue, i (i)}
    <Alert severity="error">{issue.message}</Alert>
  {/each}

  <EnvironmentsCard />

  <Card
    title={`Editing: ${config.activeEnvironment.name}`}
    subtitle="The servers this environment talks to, and which launch the Launch page opens with."
  >
    {#snippet actions()}
      {@render resetAll(
        serverFields,
        'Reset all server settings',
        'Return every server setting edited here to the environment’s own value'
      )}
    {/snippet}
    {#each serverFields as spec (spec.key)}
      <ConfigField {spec} />
    {/each}
  </Card>

  <Card
    title="User sign-in (standalone and EHR)"
    subtitle="The client a user signs in with. How it authenticates, and the aud variants, are under Testing options."
  >
    {#snippet actions()}
      {@render resetAll(
        signInFields,
        'Reset all user sign-in settings',
        'Return every user sign-in setting edited here to the environment’s own value'
      )}
    {/snippet}
    {#each signInFields as spec (spec.key)}
      <ConfigField {spec} />
    {/each}
  </Card>

  <Card
    title="Backend Services"
    subtitle="Client credentials with a signed JWT assertion, no user. Often a separately registered client."
  >
    {#snippet actions()}
      {@render resetAll(
        backendFields,
        'Reset all Backend Services settings',
        'Return every Backend Services setting edited here to the environment’s own value'
      )}
    {/snippet}
    {#each backendFields as spec (spec.key)}
      <ConfigField {spec} />
    {/each}
    <p class="text-fg-muted mt-2 text-xs" data-testid="backend-key-status">
      {#if backendKey}
        Signing key: {backendKey.alg}, {backendKey.source === 'generated'
          ? 'generated'
          : backendKey.source === 'imported'
            ? 'imported'
            : 'from the deployment'}
        {formatAbsolute(new Date(backendKey.createdAt))}.
      {:else}
        No signing key yet for this environment.
      {/if}
      <a class="underline" href="/launch">Manage it on the Launch page</a>.
    </p>
  </Card>

  <Card title="Redirect URI" subtitle="Derived from the current origin; not configurable.">
    {#snippet actions()}
      <CopyButton value={config.redirectUri} />
    {/snippet}
    <code class="bg-bg border-border inline-block rounded border px-2 py-1 font-mono text-sm">
      {config.redirectUri}
    </code>
    <p class="text-fg-muted mt-2 text-xs">
      Register this exact string with your client. A callback arriving at
      <code class="font-mono">/</code>, <code class="font-mono">/index.html</code> or any path
      carrying <code class="font-mono">code</code> is still handled, so an existing registration keeps
      working.
    </p>
  </Card>

  <Card
    title="Swiss FRAME_ANCESTOR Setting"
    subtitle="Configured at deployment time. Cannot be set in the UI."
  >
    {#if config.frameAncestors === undefined}
      <p class="text-fg-muted text-sm">
        Unknown: <code class="font-mono text-xs">/swiss-env.json</code> could not be fetched, and the
        policy is read from its response.
      </p>
    {:else if config.frameAncestors === null}
      <p class="text-sm">
        This server sends no <code class="font-mono text-xs">frame-ancestors</code>, so any site may
        show Swiss in a frame.
      </p>
      <p class="text-fg-muted mt-2 text-xs">
        Expected from the development server, which sends no security headers. The container always
        sends one.
      </p>
    {:else}
      <div class="flex flex-wrap gap-1.5" data-testid="frame-ancestors">
        {#each config.frameAncestors as source (source)}
          <code class="bg-bg border-border rounded border px-2 py-1 font-mono text-sm"
            >{source}</code
          >
        {/each}
      </div>
      <p class="text-fg-muted mt-2 text-xs">
        {#if config.frameAncestors.includes("'none'")}
          No site may show Swiss in a frame, not even Swiss itself.
        {:else if config.frameAncestors.every((s) => s === "'self'")}
          Only Swiss itself. An EHR that shows apps inside its own screen is refused; a launch that
          opens Swiss in a new tab is not affected.
        {:else}
          Swiss itself{config.frameAncestors.includes("'self'") ? ' and' : ''} the sites listed may show
          Swiss in a frame, as an EHR does when it shows apps inside its own screen.
        {/if}
      </p>
    {/if}
    <p class="text-fg-muted mt-2 text-xs">
      For more information on how to control this setting, check the
      <a class="underline" href="/how-it-works#container">Container documentation</a>
    </p>
  </Card>

  <Card title="Testing options" subtitle="In-app only. Per-experiment, not per-deployment.">
    {#snippet actions()}
      {@render resetAll(
        testingFields,
        'Reset all testing options',
        'Return every testing option changed here to its default'
      )}
    {/snippet}
    {#each testingFields as spec (spec.key)}
      <ConfigField {spec} />
    {/each}
  </Card>

  {#if config.warnings.length > 0}
    <Card title="Warnings" subtitle="Swiss will still run. These are things worth knowing.">
      <ul class="space-y-2">
        {#each config.warnings as issue, i (i)}
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
        {#each config.ignoredKeys as issue, i (i)}
          <li class="text-fg-muted text-xs">
            <code class="font-mono">{issue.ignoredKey}</code> &mdash; {issue.message}
          </li>
        {/each}
      </ul>
    </Card>
  {/if}

  <ImportExportCard />

  <Card title="Session fingerprint" subtitle="Identifies the auth-critical settings in effect.">
    <code class="text-fg-muted font-mono text-[11px] break-all">{config.fingerprint}</code>
    <p class="text-fg-muted mt-2 text-xs">
      Stored alongside a session so Swiss can tell you when tokens were issued under different
      settings, rather than silently showing tokens from one server as if they belonged to another.
      The client secret contributes only whether it is set, never its value.
    </p>
  </Card>
</div>
