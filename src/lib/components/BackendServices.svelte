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
  import { onMount } from 'svelte';
  import { config } from '#lib/config/config.svelte.ts';
  import { fieldSpec } from '#lib/config/fields.ts';
  import { snapshotConfig } from '#lib/config/merge.ts';
  import type { BackendAuthMethod } from '#lib/config/types.ts';
  import { diagnostics } from '#lib/diagnostics/diagnostics.svelte.ts';
  import { session } from '#lib/auth/session.svelte.ts';
  import { exchangeLog } from '#lib/http/log.svelte.ts';
  import {
    backendUsesSecret,
    requestBackendToken,
    suggestSystemScopes,
    type BuiltAssertion
  } from '#lib/oidc/assertion.ts';
  import { keyPairInfo, type KeyPairInfo } from '#lib/oidc/keys.ts';
  import { resolveLaunchContext } from '#lib/smart/context.ts';
  import Alert from './ui/Alert.svelte';
  import Card from './ui/Card.svelte';
  import CopyButton from './ui/CopyButton.svelte';

  let keyInfo = $state<KeyPairInfo | null>(null);
  /**
   * An EHR launch link's `iss` is applied: the endpoints are that server's,
   * named by a link, not by configuration. A signed assertion goes there only
   * once the user says so, as the launch page asks before a client secret
   * travels to such a server.
   */
  const linkNamedServer = $derived(
    config.launchInfo?.overriddenFhirBaseUrl ? config.launchInfo.fhirBaseUrl : null
  );
  let allowLinkServer = $state(false);
  let scope = $state('');
  let busy = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  let assertion = $state<BuiltAssertion | null>(null);

  const tokenEndpoint = $derived(diagnostics.endpoints.token_endpoint?.value ?? null);
  /** This environment's Backend Services client, else its sign-in client. */
  const clientId = $derived(config.current.backendClientId || config.current.clientId);
  /** Plain client credentials: the secret goes instead of an assertion. */
  const usesSecret = $derived(backendUsesSecret(config.current.backendAuthMethod));
  const authSpec = fieldSpec('backendAuthMethod');

  onMount(() => {
    scope = config.current.backendScopes || suggestSystemScopes(config.current.scopes);
  });

  // The key is managed on the Config screen; this card only needs to know it is there.
  $effect(() => {
    const envId = config.activeEnvironmentId;
    void keyPairInfo(envId).then((info) => {
      if (config.activeEnvironmentId === envId) keyInfo = info;
    });
  });

  async function requestToken() {
    if (linkNamedServer && !allowLinkServer) return;
    // Captured before the first await: the token belongs to the environment
    // and settings it was requested under, even if the tab switches meanwhile.
    const envId = config.activeEnvironmentId;
    const requestClientId = clientId;
    const method = config.current.backendAuthMethod;
    const clientSecret = config.current.clientSecret;
    const configSnapshot = snapshotConfig(config.current);
    // Also when what is held was discovered for another server: the signed
    // assertion goes to the server in effect now, never a stale one.
    if (!tokenEndpoint || diagnostics.discoveryStale) {
      await diagnostics.discover();
      if (config.activeEnvironmentId !== envId) {
        error =
          'The environment changed while the token endpoint was being discovered, so no request was sent.';
        return;
      }
    }
    const endpoint = diagnostics.endpoints.token_endpoint?.value;
    if (!endpoint) {
      error = 'No token endpoint was discovered. Run Diagnostics to see whether discovery works.';
      return;
    }

    busy = true;
    error = null;
    message = null;
    try {
      const result = await requestBackendToken({
        environmentId: envId,
        tokenEndpoint: endpoint,
        clientId: requestClientId,
        scope,
        method,
        clientSecret
      });

      assertion = result.assertion ?? null;
      if (result.exchange) exchangeLog.record(result.exchange, envId);

      if (result.buildError) {
        error = result.buildError;
        return;
      }
      if (result.error) {
        error = `${result.error.error}${result.error.error_description ? `: ${result.error.error_description}` : ''}`;
        return;
      }
      if (!result.tokens) {
        error = 'The request did not complete. The exchange log has the raw attempt.';
        return;
      }

      const obtainedAt = Date.now();
      session.establish(envId, 'backend-services', {
        tokens: result.tokens,
        // Context-free by definition: there is no user and no launch.
        context: resolveLaunchContext(result.tokens),
        obtainedAt,
        expiresAt:
          typeof result.tokens.expires_in === 'number'
            ? obtainedAt + result.tokens.expires_in * 1000
            : null,
        requestedScopes: scope,
        intent: { flavor: 'backend-services' },
        configSnapshot,
        tokenEndpoint: endpoint,
        revocationEndpoint: diagnostics.endpoints.revocation_endpoint?.value,
        endSessionEndpoint: undefined
      });
      message = [
        'Access token obtained. There is no launch context or ID token in this flow.',
        ...(result.findings ?? [])
      ].join(' ');
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-6">
  {#if message}
    <Alert severity="info">{message}</Alert>
  {/if}
  {#if error}
    <Alert severity="error" title="Backend services request failed">
      <p>{error}</p>
    </Alert>
  {/if}

  <Card
    title="Request a token"
    subtitle={`grant_type=client_credentials with ${usesSecret ? 'the client secret' : 'the signed assertion'}.`}
  >
    <div class="space-y-3">
      <div>
        <label for="backend-scope" class="text-sm font-medium">System scopes</label>
        <input
          id="backend-scope"
          type="text"
          bind:value={scope}
          spellcheck="false"
          class="border-border-control bg-bg mt-1 w-full rounded-md border px-2 py-1.5 font-mono text-xs"
        />
        <p class="text-fg-muted mt-1 text-xs">
          Uses <code class="font-mono">system/</code> scopes; with no user, patient, user, OIDC and launch
          scopes do not apply. Pre-filled from your configured scopes.
        </p>
      </div>

      <div>
        <label for="backend-auth-method" class="text-sm font-medium">Client authentication</label>
        <select
          id="backend-auth-method"
          value={config.current.backendAuthMethod}
          onchange={(event) =>
            config.set('backendAuthMethod', event.currentTarget.value as BackendAuthMethod)}
          class="border-border-control bg-bg mt-1 block w-full rounded-md border px-2 py-1.5 text-sm"
        >
          {#each authSpec.options ?? [] as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        <p class="text-fg-muted mt-1 text-xs" data-testid="backend-client-auth">
          {#if usesSecret}
            Sends the client secret{config.current.clientSecret ? '' : ', but none is set'}. Set it
            on
            <a class="underline" href="/config">Config</a>. No key needed.
          {:else}
            {#if keyInfo}
              Sends an assertion signed with key
              <span class="font-mono break-all">{keyInfo.kid}</span> ({keyInfo.alg}).
            {:else}
              Sends a signed assertion, but this environment has no signing key yet.
            {/if}
            Manage the key on <a class="underline" href="/config">Config</a>.
          {/if}
        </p>
      </div>

      <dl class="space-y-1 text-xs">
        <div class="flex flex-wrap gap-2">
          <dt class="text-fg-muted w-28 shrink-0">Token endpoint</dt>
          <dd class="font-mono break-all">{tokenEndpoint ?? 'not discovered yet'}</dd>
        </div>
        <div class="flex flex-wrap gap-2">
          <dt class="text-fg-muted w-28 shrink-0">Client ID</dt>
          <dd class="font-mono">
            {clientId || '(not set)'}
            {#if config.current.backendClientId}
              <span class="text-fg-muted font-sans">(the Backend Services client)</span>
            {/if}
          </dd>
        </div>
      </dl>

      {#if linkNamedServer}
        <label class="text-warning flex cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            bind:checked={allowLinkServer}
            class="accent-primary mt-0.5 h-3.5 w-3.5"
          />
          <span>
            A launch link named <span class="font-mono break-all">{linkNamedServer}</span>, so your
            {usesSecret ? 'client secret' : 'signed assertion'} would go to its token endpoint, not your
            configured one. Tick to send it there.
          </span>
        </label>
      {/if}
      <button
        type="button"
        class="bg-primary text-on-primary rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        disabled={busy ||
          (!usesSecret && !keyInfo) ||
          !clientId ||
          Boolean(linkNamedServer && !allowLinkServer)}
        onclick={requestToken}
      >
        {busy ? 'Requesting…' : 'Request access token'}
      </button>
    </div>

    {#if assertion}
      <details class="border-border mt-4 rounded-md border" open>
        <summary class="flex items-center gap-2 px-3 py-1.5 text-xs font-medium">
          The assertion that was signed
          <span class="ml-auto"><CopyButton value={assertion.jwt} label="Copy JWT" /></span>
        </summary>
        <div class="space-y-2 px-3 pb-3">
          <div>
            <p class="text-fg-muted text-xs">Header</p>
            <pre
              class="bg-bg border-border mt-1 overflow-auto rounded border p-2 font-mono text-[11px]">{JSON.stringify(
                assertion.header,
                null,
                2
              )}</pre>
          </div>
          <div>
            <p class="text-fg-muted text-xs">Claims</p>
            <pre
              class="bg-bg border-border mt-1 overflow-auto rounded border p-2 font-mono text-[11px]">{JSON.stringify(
                assertion.claims,
                null,
                2
              )}</pre>
            <p class="text-fg-muted mt-1 text-xs">
              <code class="font-mono">aud</code> is the token endpoint, not the FHIR server: a common
              cause of rejected assertions.
            </p>
          </div>
        </div>
      </details>
    {/if}
  </Card>
</div>
