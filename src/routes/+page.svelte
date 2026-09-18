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
  import { untrack } from 'svelte';
  import { config } from '$lib/config/config.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { parseFhirUser } from '$lib/smart/context';
  import type { ContextValue } from '$lib/smart/types';
  import Alert from '$lib/components/ui/Alert.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import Markdown from '$lib/components/Markdown.svelte';
  import SourceBadge from '$lib/components/ui/SourceBadge.svelte';
  import TokenPanel from '$lib/components/TokenPanel.svelte';
  import ExpiryCountdown from '$lib/components/ExpiryCountdown.svelte';
  import ScopeDiff from '$lib/components/ScopeDiff.svelte';

  let message = $state<string | null>(null);
  let refreshScope = $state('');
  let showRefreshScope = $state(false);

  const summary = [
    { key: 'fhirBaseUrl' as const, label: 'FHIR base' },
    { key: 'authIssuer' as const, label: 'Authorization server' },
    { key: 'clientId' as const, label: 'Client ID' }
  ];

  const fhirUser = $derived(
    session.context?.fhirUser.value
      ? parseFhirUser(session.context.fhirUser.value, config.current.fhirBaseUrl)
      : null
  );

  const logout = $derived(session.endSessionUrl());

  /**
   * Against a local server a refresh or revoke can finish in a few
   * milliseconds, which makes the spinner a flicker nobody can read. Hold it
   * for a minimum time instead. Only the spinner is held: the buttons follow
   * `session.busy` directly, so nothing is blocked for longer than the request.
   */
  const MIN_SPINNER_MS = 600;
  let spinnerVisible = $state(false);
  let spinnerShownAt = 0;

  $effect(() => {
    if (session.busy) {
      untrack(() => {
        if (!spinnerVisible) {
          spinnerVisible = true;
          spinnerShownAt = Date.now();
        }
      });
      return;
    }
    if (!untrack(() => spinnerVisible)) return;
    const remaining = MIN_SPINNER_MS - (Date.now() - spinnerShownAt);
    // Cleared if another request starts first, or the page is left.
    const timer = setTimeout(() => (spinnerVisible = false), Math.max(0, remaining));
    return () => clearTimeout(timer);
  });

  async function doRefresh() {
    const result = await session.refresh(
      showRefreshScope && refreshScope.trim() ? { scope: refreshScope.trim() } : {}
    );
    message = result.message;
  }

  async function doRevoke() {
    const result = await session.revoke();
    message = result.message;
  }

  function contextLine(label: string, value: ContextValue) {
    return { label, value };
  }

  const contextRows = $derived(
    session.context
      ? [
          contextLine('patient', session.context.patient),
          contextLine('encounter', session.context.encounter),
          contextLine('fhirUser', session.context.fhirUser)
        ]
      : []
  );

  const SOURCE_NOTES: Record<string, string> = {
    'token-response': 'from the token response (authoritative)',
    'id-token': 'from an ID token claim',
    'access-token':
      'from an access token claim — non-normative, since the access token is opaque to clients by spec',
    none: 'not provided'
  };
</script>

<div class="space-y-6">
  <header>
    <div class="flex items-center gap-3">
      <h1 class="text-2xl font-semibold">Session</h1>
      <!-- Set only by Refresh now and Revoke. -->
      {#if spinnerVisible}<Spinner label="Updating the session" />{/if}
    </div>
    <p class="text-fg-muted mt-1 text-sm">
      Inspect the tokens, launch context and granted scopes for the current session.
    </p>
  </header>

  {#if config.loadError}
    <Alert severity="error" title="Runtime configuration could not be loaded">
      <p>{config.loadError}</p>
      <p class="mt-2">
        Running on built-in defaults. <a class="underline" href="/config">Open Configuration</a>.
      </p>
    </Alert>
  {/if}

  {#if message}
    <Alert severity="info"><Markdown text={message} inline /></Alert>
  {/if}

  {#if session.lastError}
    <Alert severity="error" title={session.lastError.error}>
      <p>{session.lastError.error_description ?? 'No description was provided.'}</p>
    </Alert>
  {/if}

  {#if session.staleConfig}
    <Alert severity="warning" title="These tokens were issued under different settings">
      <p>
        {#if session.staleFields.length > 0}
          Changed since the launch: {session.staleFields.join(', ')}.
        {:else}
          The authorization configuration has changed since these tokens were issued.
        {/if}
      </p>
      <p class="mt-2">
        The tokens are still real and still shown &mdash; watching a server reject them is a
        legitimate test &mdash; but they no longer correspond to the configuration on the
        Configuration page.
      </p>
    </Alert>
  {/if}

  {#if !session.isAuthenticated}
    <Card title="No active session">
      <p class="text-fg-muted text-sm">No access token yet.</p>
      <div class="mt-3 flex flex-wrap gap-3">
        <a href="/launch" class="bg-primary rounded-md px-3 py-1.5 text-sm font-medium text-white">
          Start a launch
        </a>
        <a
          href="/diagnostics"
          class="border-border text-fg-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm"
        >
          Check the configuration first
        </a>
      </div>
    </Card>
  {:else}
    <Card title="Access token lifetime">
      {#snippet actions()}
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="bg-primary rounded px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
            disabled={session.busy}
            onclick={doRefresh}
          >
            {session.busy ? 'Working…' : 'Refresh now'}
          </button>
          <button
            type="button"
            class="border-border text-fg-muted hover:text-fg rounded border px-2 py-1 text-xs"
            disabled={session.busy}
            onclick={doRevoke}
          >
            Revoke
          </button>
          <button
            type="button"
            class="border-border text-fg-muted hover:text-fg rounded border px-2 py-1 text-xs"
            onclick={() => {
              session.clear();
              message = 'Local tokens discarded.';
            }}
          >
            Discard locally
          </button>
        </div>
      {/snippet}

      <ExpiryCountdown />

      <label class="text-fg-muted mt-3 flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" bind:checked={showRefreshScope} class="accent-primary h-3.5 w-3.5" />
        Request a narrower scope on refresh
      </label>
      {#if showRefreshScope}
        <input
          type="text"
          bind:value={refreshScope}
          placeholder={session.current?.requestedScopes ?? ''}
          class="border-border bg-bg mt-1.5 w-full rounded-md border px-2 py-1.5 font-mono text-xs"
        />
        <p class="text-fg-muted mt-1 text-xs">
          Down-scoping on refresh is legal, and a direct way to check that your server enforces
          scope reduction rather than re-issuing everything.
        </p>
      {/if}

      {#if !session.current?.tokens.refresh_token}
        <p class="text-fg-muted mt-2 text-xs">
          No refresh token was issued, so &ldquo;Refresh now&rdquo; will fail. That needs
          <code class="font-mono">offline_access</code> in the scopes and the Refresh Token flow enabled
          for your client.
        </p>
      {/if}

      {#if !logout.url}
        <p class="text-fg-muted mt-2 text-xs"><Markdown text={logout.reason ?? ''} inline /></p>
      {:else}
        <p class="mt-2 text-xs">
          <a href={logout.url} class="text-primary hover:underline">
            Log out at the identity provider
          </a>
        </p>
      {/if}
    </Card>

    <Card title="Launch context" subtitle="Where each value came from.">
      {#if contextRows.every((r) => !r.value.value)}
        <p class="text-fg-muted text-sm">
          No launch context was returned. Expected, unless you requested a
          <code class="font-mono text-xs">launch</code> scope.
        </p>
      {:else}
        <dl class="space-y-2">
          {#each contextRows as row (row.label)}
            {#if row.value.value}
              <div class="flex flex-wrap items-baseline gap-2">
                <dt class="text-fg-muted w-24 shrink-0 font-mono text-xs">{row.label}</dt>
                <dd class="font-mono text-sm">{row.value.value}</dd>
                <span class="text-fg-muted text-[10px] italic">
                  {SOURCE_NOTES[row.value.source]}
                </span>
              </div>
              {#if row.value.conflict}
                <p class="text-warning pl-26 text-xs">
                  Conflicting value <span class="font-mono">{row.value.conflict.value}</span>
                  {SOURCE_NOTES[row.value.conflict.source]}. Two sources disagree, which is a bug in
                  your server.
                </p>
              {/if}
            {/if}
          {/each}
        </dl>

        {#if fhirUser}
          <div class="border-border mt-3 border-t pt-3 text-xs">
            <p class="font-medium">fhirUser resolves to</p>
            <p class="text-fg-muted mt-0.5 font-mono">
              {fhirUser.resourceType}/{fhirUser.id}
            </p>
            {#if fhirUser.unexpectedType}
              <p class="text-warning mt-1">
                <code class="font-mono">{fhirUser.unexpectedType}</code> is outside the resource types
                SMART permits for fhirUser (Patient, Practitioner, PractitionerRole, RelatedPerson, Person).
              </p>
            {/if}
            {#if fhirUser.crossOrigin}
              <p class="text-warning mt-1">
                This points at a different origin than your FHIR base, so fetching it would be
                cross-origin and is likely to be CORS-blocked.
              </p>
            {/if}
          </div>
        {/if}

        {#if session.context?.needPatientBanner !== undefined}
          <p class="text-fg-muted mt-2 text-xs">
            need_patient_banner: <span class="font-mono"
              >{String(session.context.needPatientBanner)}</span
            >
          </p>
        {/if}
      {/if}

      {#if session.context && Object.keys(session.context.extras).length > 0}
        <div class="border-border mt-3 border-t pt-3">
          <p class="text-xs font-medium">Additional parameters returned by your server</p>
          <dl class="mt-1 space-y-0.5">
            {#each Object.entries(session.context.extras) as [key, value] (key)}
              <div class="flex gap-2 font-mono text-[11px]">
                <dt class="text-json-key w-32 shrink-0">{key}</dt>
                <dd class="break-all">{JSON.stringify(value)}</dd>
              </div>
            {/each}
          </dl>
        </div>
      {/if}
    </Card>

    {#if session.scopeDiff && session.grantedScopes}
      <Card title="Granted vs Requested Scopes" subtitle="What you actually hold.">
        <ScopeDiff diff={session.scopeDiff} source={session.grantedScopes.source} />
      </Card>
    {/if}

    <Card title="Tokens">
      <div class="-mx-4 -my-3">
        <TokenPanel
          title="Access token"
          token={session.tokens?.access_token}
          header={session.accessTokenJwt?.header}
          claims={session.accessTokenJwt?.claims}
          note={session.accessTokenJwt
            ? 'This access token happens to be a JWT, so its claims are shown. Per spec an access token is opaque to clients, so nothing here should be relied on.'
            : 'This access token is opaque, which is what the specification expects. There is nothing to decode.'}
        />
        <TokenPanel
          title="ID token"
          token={session.tokens?.id_token}
          header={session.idTokenJwt?.header}
          claims={session.idTokenJwt?.claims}
          note={session.tokens?.id_token
            ? undefined
            : 'No ID token was issued. That needs the openid scope.'}
        />
        <TokenPanel
          title="Refresh token"
          token={session.tokens?.refresh_token}
          sensitive
          note="Long-lived and sensitive: this can mint new access tokens without any further user interaction."
        />
      </div>
    </Card>
  {/if}

  <Card title="Effective configuration" subtitle="What a launch would use right now.">
    {#snippet actions()}
      <a href="/config" class="text-primary text-xs hover:underline">Edit</a>
    {/snippet}

    <dl class="space-y-1.5">
      {#each summary as row (row.key)}
        <div class="flex flex-wrap items-baseline gap-2">
          <dt class="text-fg-muted w-44 shrink-0 text-xs">{row.label}</dt>
          <dd class="font-mono text-sm break-all">{config.current[row.key] || '—'}</dd>
          <SourceBadge source={config.sourceOf(row.key)} />
        </div>
      {/each}
      <div class="flex flex-wrap items-baseline gap-2">
        <dt class="text-fg-muted w-44 shrink-0 text-xs">Redirect URI</dt>
        <dd class="font-mono text-sm break-all">{config.redirectUri}</dd>
        <span class="text-fg-muted text-[10px] italic">derived</span>
      </div>
      <div class="flex flex-wrap items-baseline gap-2">
        <dt class="text-fg-muted w-44 shrink-0 text-xs">Scopes</dt>
        <dd class="font-mono text-xs break-all">{config.current.scopes}</dd>
        <SourceBadge source={config.sourceOf('scopes')} />
      </div>
    </dl>

    {#if config.overriddenKeys.length > 0}
      <p class="text-warning mt-3 text-xs">
        {config.overriddenKeys.length} setting(s) overridden in this browser.
      </p>
    {/if}
  </Card>
</div>
