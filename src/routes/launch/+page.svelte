<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { config } from '$lib/config/config.svelte';
  import { diagnostics } from '$lib/diagnostics/diagnostics.svelte';
  import { adjustScopesForFlavor, beginAuthorization } from '$lib/auth/flow';
  import { session } from '$lib/auth/session.svelte';
  import { cancelFlow, getFlowState } from '$lib/auth/transaction';
  import { canUseS256 } from '$lib/oidc/pkce';
  import Alert from '$lib/components/ui/Alert.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import BackendServices from '$lib/components/BackendServices.svelte';

  type Mode = 'standalone' | 'ehr' | 'backend';

  let mode = $state<Mode>('standalone');
  let starting = $state(false);
  let error = $state<string | null>(null);
  let preview = $state<string | null>(null);
  let verbatimScopes = $state(false);
  let flowState = $state(getFlowState());

  /** EHR launch parameters, read from the URL at mount. */
  const iss = $derived(page.url.searchParams.get('iss'));
  const launchToken = $derived(page.url.searchParams.get('launch'));
  const isEhrLaunch = $derived(iss !== null || launchToken !== null);

  const scopeAdjustment = $derived(adjustScopesForFlavor(config.current.scopes, 'ehr'));

  onMount(() => {
    flowState = getFlowState();

    if (iss) {
      mode = 'ehr';
      // `iss` wins over configured values, but as an EPHEMERAL layer -- one
      // EHR launch must not quietly rewrite the user's saved configuration.
      config.applyLaunchOverride({
        fhirBaseUrl: iss,
        overriddenFhirBaseUrl: config.base.fhirBaseUrl !== iss ? config.base.fhirBaseUrl : undefined
      });
      void diagnostics.discover();
    } else if (launchToken) {
      mode = 'ehr';
    }
  });

  async function start(previewOnly = false) {
    starting = true;
    error = null;
    preview = null;
    try {
      const result = await beginAuthorization({
        intent:
          mode === 'ehr'
            ? { flavor: 'ehr', launch: launchToken ?? undefined, iss: iss ?? undefined }
            : { flavor: 'standalone' },
        verbatimScopes,
        previewOnly
      });
      if (!result.ok) error = result.error ?? 'Could not start the launch.';
      else if (previewOnly) preview = result.authorizeUrl ?? null;
    } finally {
      starting = false;
    }
  }
</script>

<div class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">Launch</h1>
    <p class="text-fg-muted mt-1 text-sm">
      Start a SMART authorization flow. Swiss builds the request itself, so you can inspect every
      parameter before it is sent.
    </p>
  </header>

  {#if !canUseS256()}
    <Alert severity="error" title="PKCE cannot be used on this origin">
      <p>
        <code class="font-mono text-xs">crypto.subtle</code> is unavailable because
        <code class="font-mono text-xs">{config.origin}</code> is not a secure context, so the S256 code
        challenge cannot be computed.
      </p>
      <p class="mt-2">
        Use <code class="font-mono text-xs">http://localhost:4200</code> instead, or serve Swiss
        over HTTPS. Note that <code class="font-mono text-xs">http://&lt;lan-ip&gt;</code> is
        <em>not</em> a secure context, which is what the Swiss 2.x README recommended.
      </p>
    </Alert>
  {/if}

  {#if flowState !== 'idle'}
    <Alert severity="warning" title="An authorization flow is already in progress">
      <p>
        Swiss is waiting for a redirect to come back. Finish it, or cancel to discard the pending
        PKCE verifier and start over.
      </p>
      <button
        type="button"
        class="border-warning text-warning mt-2 rounded border px-2 py-1 text-xs"
        onclick={() => {
          cancelFlow();
          flowState = 'idle';
        }}
      >
        Cancel the pending flow
      </button>
    </Alert>
  {/if}

  {#if session.isAuthenticated}
    <Alert severity="info" title="You already have an active session">
      <p>
        Starting a new launch will replace it. <a class="underline" href="/"
          >View the current session</a
        >.
      </p>
    </Alert>
  {/if}

  {#if isEhrLaunch}
    <Card title="EHR launch detected" subtitle="Parameters supplied by the launching system.">
      <dl class="space-y-2 text-sm">
        <div class="flex flex-wrap items-baseline gap-2">
          <dt class="text-fg-muted w-32 shrink-0 text-xs">iss (FHIR base)</dt>
          <dd class="font-mono text-xs break-all">{iss ?? '— not provided'}</dd>
        </div>
        <div class="flex flex-wrap items-baseline gap-2">
          <dt class="text-fg-muted w-32 shrink-0 text-xs">launch</dt>
          <dd class="font-mono text-xs break-all">{launchToken ?? '— not provided'}</dd>
        </div>
      </dl>

      {#if !iss}
        <Alert severity="error" title="No iss parameter">
          <p class="mt-1">
            An EHR launch must include <code class="font-mono text-xs">iss</code>, the FHIR base URL
            of the launching system. Without it Swiss cannot tell which server to discover.
          </p>
        </Alert>
      {:else if !launchToken}
        <Alert severity="warning" title="No launch parameter">
          <p class="mt-1">
            <code class="font-mono text-xs">iss</code> was provided without
            <code class="font-mono text-xs">launch</code>. Swiss can continue as a standalone launch
            against that FHIR base, which is a legitimate thing to test, but it is not an EHR
            launch.
          </p>
        </Alert>
      {/if}

      {#if config.launchInfo?.overriddenFhirBaseUrl}
        <Alert severity="info" title="FHIR base overridden for this session">
          <p class="mt-1">
            Using <code class="font-mono text-xs">{config.launchInfo.fhirBaseUrl}</code> from the
            launch. Your configured value
            <code class="font-mono text-xs">{config.launchInfo.overriddenFhirBaseUrl}</code> is not being
            used, and this override is not saved.
          </p>
        </Alert>
      {/if}

      {#if scopeAdjustment.changes.length > 0}
        <div class="border-border mt-3 border-t pt-3">
          <p class="text-sm font-medium">Scope adjustment</p>
          <ul class="text-fg-muted mt-1 list-inside list-disc space-y-0.5 text-xs">
            {#each scopeAdjustment.changes as change (change)}
              <li>{change}</li>
            {/each}
          </ul>
          <label class="text-fg-muted mt-2 flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              bind:checked={verbatimScopes}
              class="accent-primary h-3.5 w-3.5"
            />
            Send my scopes verbatim instead (tests the non-conforming case)
          </label>
        </div>
      {/if}
    </Card>
  {/if}

  <Card title="Launch mode">
    <div class="space-y-2">
      {#each [{ value: 'standalone' as Mode, label: 'Standalone launch', help: 'Swiss starts the flow itself. The usual way to test an OIDC configuration.' }, { value: 'ehr' as Mode, label: 'EHR launch', help: 'Driven by ?iss= and ?launch= on this page’s URL, supplied by the launching system.' }, { value: 'backend' as Mode, label: 'Backend services', help: 'Client credentials with a signed JWT assertion. No user, no launch context.' }] as option (option.value)}
        <label class="flex cursor-pointer items-start gap-2.5">
          <input
            type="radio"
            name="launch-mode"
            value={option.value}
            checked={mode === option.value}
            onchange={() => (mode = option.value)}
            class="accent-primary mt-1"
          />
          <span>
            <span class="text-sm font-medium">{option.label}</span>
            <span class="text-fg-muted block text-xs">{option.help}</span>
          </span>
        </label>
      {/each}
    </div>
  </Card>

  {#if mode === 'backend'}
    <BackendServices />
  {:else}
    <Card title="Request summary" subtitle="What Swiss will send.">
      <dl class="space-y-1.5 text-xs summary-adjust">
        <div class="flex flex-wrap items-baseline gap-2">
          <dt class="text-fg-muted w-36 shrink-0">Authorization endpoint</dt>
          <dd class="font-mono break-all">
            {diagnostics.endpoints.authorization_endpoint?.value ?? 'not discovered yet'}
          </dd>
        </div>
        <div class="flex flex-wrap items-baseline gap-2">
          <dt class="text-fg-muted w-36 shrink-0">redirect_uri</dt>
          <dd class="font-mono break-all">{config.redirectUri}</dd>
        </div>
        <div class="flex flex-wrap items-baseline gap-2">
          <dt class="text-fg-muted w-36 shrink-0">aud</dt>
          <dd class="font-mono break-all">
            {config.current.audMode === 'omit' ? '(omitted)' : config.current.fhirBaseUrl}
          </dd>
        </div>
        <div class="flex flex-wrap items-baseline gap-2">
          <dt class="text-fg-muted w-36 shrink-0">scope</dt>
          <dd class="font-mono break-all">
            {mode === 'ehr' && !verbatimScopes ? scopeAdjustment.scopes : config.current.scopes}
          </dd>
        </div>
      </dl>

      {#if !diagnostics.endpoints.authorization_endpoint}
        <Alert severity="info">
          <p>
            No authorization endpoint discovered yet. Swiss will run discovery when you start the
            launch, or you can <a class="underline" href="/diagnostics">run diagnostics first</a> to see
            whether the documents are reachable.
          </p>
        </Alert>
      {/if}

      {#if error}
        <Alert severity="error" title="Could not start the launch">
          <p>{error}</p>
        </Alert>
      {/if}

      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="bg-primary rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          disabled={starting || !canUseS256() || (mode === 'ehr' && !iss)}
          onclick={() => void start(false)}
        >
          {starting ? 'Starting…' : 'Start launch'}
        </button>
        <button
          type="button"
          class="border-border text-fg-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={starting}
          onclick={() => void start(true)}
        >
          Preview the URL
        </button>
      </div>

      {#if preview}
        <div class="mt-3">
          <p class="text-sm font-medium">Authorization URL</p>
          <pre
            class="bg-bg border-border mt-1 max-h-48 overflow-auto rounded border p-2 font-mono text-[11px] break-all whitespace-pre-wrap">{preview}</pre>
          <p class="text-fg-muted mt-1 text-xs">
            Generated with a throwaway PKCE verifier; starting the launch creates a fresh one.
          </p>
        </div>
      {/if}
    </Card>
  {/if}
</div>
