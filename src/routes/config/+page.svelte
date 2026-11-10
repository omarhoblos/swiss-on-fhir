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
  import { fieldSpec } from '#lib/config/fields.ts';
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

<div class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">Configuration</h1>
    <p class="text-fg-muted mt-1 text-sm">
      The Default environment starts from <code class="font-mono text-xs">.env</code>. Edits here
      are stored in this browser, over each environment&rsquo;s own values; they never change
      <code class="font-mono text-xs">.env</code>.
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
        is readable by anyone who can reach this Swiss. Only ship these on a network you control.
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
        Swiss is using its built-in defaults, not the deployment&rsquo;s
        <code class="font-mono text-xs">.env</code>. You can still set everything below.
      </p>
    </Alert>
  {/if}

  {#if config.launchInfo}
    <Alert severity="info" title="FHIR base URL overridden by an EHR launch">
      <p>
        Using <code class="font-mono text-xs">{config.launchInfo.fhirBaseUrl}</code> from the
        EHR&rsquo;s
        <code class="font-mono text-xs">iss</code>{#if config.launchInfo.overriddenFhirBaseUrl}
          instead of
          <code class="font-mono text-xs">{config.launchInfo.overriddenFhirBaseUrl}</code>{/if}. Not
        saved.
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
    {#each serverFields as spec (spec.key)}
      <ConfigField {spec} />
    {/each}
  </Card>

  <Card
    title="User sign-in (standalone and EHR)"
    subtitle="The client a user signs in with. Client authentication and aud variants are under Testing options."
  >
    {#each signInFields as spec (spec.key)}
      <ConfigField {spec} />
    {/each}
  </Card>

  <Card
    title="Backend Services"
    subtitle="Client credentials with a signed JWT assertion, no user."
  >
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
      Register this exact string with your client. Callbacks to <code class="font-mono">/</code>,
      <code class="font-mono">/index.html</code> or any path carrying
      <code class="font-mono">code</code> are also handled.
    </p>
  </Card>

  <Card
    title="Swiss FRAME_ANCESTOR Setting"
    subtitle="Configured at deployment time. Cannot be set in the UI."
  >
    {#if config.frameAncestors === undefined}
      <p class="text-fg-muted text-sm">
        Unknown: <code class="font-mono text-xs">/swiss-env.json</code> could not be fetched.
      </p>
    {:else if config.frameAncestors === null}
      <p class="text-sm">
        This server sends no <code class="font-mono text-xs">frame-ancestors</code>, so any site may
        show Swiss in a frame.
      </p>
      <p class="text-fg-muted mt-2 text-xs">
        Expected from the development server. The container always sends one.
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
          Only Swiss itself. An EHR that embeds apps is refused; a launch in a new tab still works.
        {:else}
          Swiss itself{config.frameAncestors.includes("'self'") ? ' and' : ''} the sites listed may show
          Swiss in a frame, as an EHR that embeds apps does.
        {/if}
      </p>
    {/if}
    <p class="text-fg-muted mt-2 text-xs">
      To change it, see the
      <a class="underline" href="/how-it-works#container">Container documentation</a>.
    </p>
  </Card>

  <Card title="Testing options" subtitle="In-app only. Per-experiment, not per-deployment.">
    {#each testingFields as spec (spec.key)}
      <ConfigField {spec} />
    {/each}
  </Card>

  {#if config.warnings.length > 0}
    <Card title="Warnings" subtitle="Swiss still runs.">
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
      subtitle="Recognised and not used. Your .env does not need changing."
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
      Stored with a session, so Swiss can warn when tokens were issued under different settings. The
      client secret counts only as set or not set.
    </p>
  </Card>
</div>
