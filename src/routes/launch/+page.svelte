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
  import { onDestroy, onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { httpUrl, originOf } from '$lib/url';
  import { config } from '$lib/config/config.svelte';
  import { diagnostics } from '$lib/diagnostics/diagnostics.svelte';
  import { adjustScopesForFlavor, beginAuthorization } from '$lib/auth/flow';
  import { session } from '$lib/auth/session.svelte';
  import { cancelFlow, getFlowState } from '$lib/auth/transaction';
  import { canUseS256 } from '$lib/oidc/pkce';
  import Alert from '$lib/components/ui/Alert.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import BackendServices from '$lib/components/BackendServices.svelte';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import Markdown from '$lib/components/Markdown.svelte';

  type Mode = 'standalone' | 'ehr' | 'backend';

  let mode = $state<Mode>('standalone');
  let starting = $state(false);
  let error = $state<string | null>(null);
  let preview = $state<string | null>(null);
  let verbatimScopes = $state(false);
  let flowState = $state(getFlowState());

  /** EHR launch parameters, read from the URL at mount. */
  const rawIss = $derived(page.url.searchParams.get('iss'));
  // Only an http(s) iss is ever used: it becomes the FHIR base, the aud, and
  // the host every discovery document is fetched from.
  const iss = $derived(httpUrl(rawIss));
  const issRejected = $derived(rawIss !== null && iss === null);
  const launchToken = $derived(page.url.searchParams.get('launch'));
  const isEhrLaunch = $derived(rawIss !== null || launchToken !== null);

  /**
   * A launch against an `iss` sends the configured client secret, if any, to
   * whatever token endpoint that server advertises. Worth saying out loud
   * when the iss came from a link rather than from configuration.
   */
  const secretWillTravel = $derived(
    iss !== null && config.current.clientSecret !== '' && config.current.clientAuthMethod !== 'none'
  );

  // For the launch that is selected, not only for an EHR one: a standalone
  // launch drops `launch` just as an EHR launch drops `launch/patient`.
  const scopeAdjustment = $derived(
    adjustScopesForFlavor(config.current.scopes, mode === 'ehr' ? 'ehr' : 'standalone')
  );
  const scopesToSend = $derived(verbatimScopes ? config.current.scopes : scopeAdjustment.scopes);

  /**
   * Where an EHR sends the user to start Swiss. An EHR launch begins in the
   * EHR, which has to be told this address in advance; it then opens it with
   * `iss` and `launch` added. Derived from the origin this page is served
   * from, like the redirect URI, so it is right wherever Swiss is deployed.
   */
  const launchUrl = $derived(config.origin ? `${config.origin}/launch` : '');

  /**
   * The FHIR base the current session's token was issued for, when this
   * launch names a different server. Said out loud because the link, not the
   * user, chose that server.
   */
  const sessionBase = $derived(session.current?.configSnapshot.fhirBaseUrl ?? '');
  const launchIsForAnotherServer = $derived(
    iss !== null && sessionBase !== '' && originOf(sessionBase) !== originOf(iss)
  );

  /**
   * The override belongs to this URL and ends with it. It used to outlive
   * the page: a link to /launch?iss=... left every later screen pointed at
   * the server the link named, including the FHIR console, which then sent
   * the existing session's bearer token there, and left that server's
   * endpoints in place for the next launch. A launch that is actually started
   * leaves by navigation, with the override already snapshotted into its
   * transaction, so nothing is lost by clearing it here.
   */
  let overrideApplied = false;

  function followIss(next: string | null) {
    if (overrideApplied) {
      config.clearLaunchOverride();
      diagnostics.resetDiscovery();
      overrideApplied = false;
      // Without an `iss` there is no EHR launch left to run.
      if (!next) mode = 'standalone';
    }
    if (!next) return;

    mode = 'ehr';
    // `iss` wins over configured values, but as an EPHEMERAL layer -- one
    // EHR launch must not quietly rewrite the user's saved configuration.
    // Compared against the effective value, in-app overrides included, so
    // the banner reflects what actually changed.
    const effective = config.current.fhirBaseUrl;
    overrideApplied = true;
    config.applyLaunchOverride({
      fhirBaseUrl: next,
      overriddenFhirBaseUrl: effective !== next ? effective : undefined
    });
    void diagnostics.discover();
  }

  /**
   * Discovers on arrival, so the request summary is filled in and a server
   * that cannot be reached is reported before "Start launch" is clicked
   * rather than after.
   *
   * Opening this page is the user's action, which keeps the rule that every
   * request is traceable to one. It is not a refetch on every visit: nothing
   * is fetched while what is held was discovered for the base and issuer now
   * configured. With an `iss`, followIss has already started it.
   */
  function discoverOnArrival() {
    if (diagnostics.discovered || diagnostics.discovering) return;
    if (!config.current.fhirBaseUrl && !config.current.authIssuer) return;
    void diagnostics.discover();
  }

  // An effect rather than onMount: the nav link to /launch reuses this
  // component, so the URL can lose its `iss` without the page being
  // destroyed. Only `iss` is tracked; the rest reads and writes config.
  $effect(() => {
    const next = iss;
    untrack(() => {
      followIss(next);
      if (!next) discoverOnArrival();
    });
  });

  onDestroy(() => followIss(null));

  onMount(() => {
    flowState = getFlowState();
    if (rawIss !== null || launchToken) mode = 'ehr';
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
      // Nothing discovered is already explained by the warning above the
      // buttons, which reads the same endpoints this launch just did. Saying
      // it again in a second alert only stacked two boxes with one message.
      if (!result.ok && result.reason !== 'no-authorization-endpoint') {
        error = result.error ?? 'Could not start the launch.';
      } else if (previewOnly) preview = result.authorizeUrl ?? null;
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

      {#if issRejected}
        <Alert severity="error" title="The iss parameter is not an http(s) URL">
          <p>
            <code class="font-mono text-xs break-all">{rawIss}</code> was ignored. An EHR launch must
            supply the FHIR base as an http(s) URL; Swiss will not fetch discovery documents from, or
            send tokens to, anything else.
          </p>
        </Alert>
      {:else if !iss}
        <Alert severity="error" title="No iss parameter">
          <p>
            An EHR launch must include <code class="font-mono text-xs">iss</code>, the FHIR base URL
            of the launching system. Without it Swiss cannot tell which server to discover.
          </p>
        </Alert>
      {:else if !launchToken}
        <Alert severity="warning" title="No launch parameter">
          <p>
            <code class="font-mono text-xs">iss</code> was provided without
            <code class="font-mono text-xs">launch</code>. Swiss can continue as a standalone launch
            against that FHIR base, which is a legitimate thing to test, but it is not an EHR
            launch.
          </p>
        </Alert>
      {/if}

      {#if config.launchInfo?.overriddenFhirBaseUrl}
        <Alert severity="info" title="FHIR base overridden for this session">
          <p>
            Using <code class="font-mono text-xs">{config.launchInfo.fhirBaseUrl}</code> from the
            launch. Your configured value
            <code class="font-mono text-xs">{config.launchInfo.overriddenFhirBaseUrl}</code> is not being
            used, and this override is not saved.
          </p>
        </Alert>
      {/if}

      {#if launchIsForAnotherServer}
        <Alert severity="warning" title="This launch is for a different server than your session">
          <p>
            You are signed in for <code class="font-mono text-xs break-all">{sessionBase}</code>;
            this launch names <code class="font-mono text-xs break-all">{iss}</code>. The existing
            token will not be sent there, and the launch only applies to this page unless you start
            it.
          </p>
        </Alert>
      {/if}

      {#if secretWillTravel}
        <Alert severity="warning" title="Your client secret will be sent to this server">
          <p>
            Client authentication is set to
            <code class="font-mono text-xs">{config.current.clientAuthMethod}</code>, so the token
            exchange will present the configured secret to whatever token endpoint
            <code class="font-mono text-xs">{iss}</code> advertises. Only continue if you trust where
            this launch came from.
          </p>
        </Alert>
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

  {#if mode === 'ehr'}
    <Card
      title="Register Swiss with the EHR"
      subtitle="An EHR launch starts in the EHR, so it needs to know where Swiss is."
    >
      <dl class="space-y-3 text-xs">
        <div>
          <div class="flex items-center gap-2">
            <dt class="text-sm font-medium">Launch URL</dt>
            <span class="ml-auto"><CopyButton value={launchUrl} label="Copy launch URL" /></span>
          </div>
          <dd class="mt-1">
            <code
              class="bg-bg border-border block rounded border p-2 font-mono text-[11px] break-all"
              data-testid="launch-url">{launchUrl}</code
            >
            <p class="text-fg-muted mt-1">
              Give this to the EHR or launcher as the app&rsquo;s launch URL. It opens it with
              <code class="font-mono">iss</code> and <code class="font-mono">launch</code> added, and
              this page picks the launch up from there.
            </p>
          </dd>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <dt class="text-sm font-medium">Redirect URI</dt>
            <span class="ml-auto"
              ><CopyButton value={config.redirectUri} label="Copy redirect URI" /></span
            >
          </div>
          <dd class="mt-1">
            <code
              class="bg-bg border-border block rounded border p-2 font-mono text-[11px] break-all"
              data-testid="redirect-uri">{config.redirectUri}</code
            >
            <p class="text-fg-muted mt-1">
              Register this on the client, along with the
              <code class="font-mono">launch</code> scope. It is where the authorization server sends
              the user back once they have signed in.
            </p>
          </dd>
        </div>
      </dl>
    </Card>
  {/if}

  {#if mode === 'backend'}
    <BackendServices />
  {:else}
    <Card title="Request summary" subtitle="What Swiss will send.">
      <dl class="summary-adjust space-y-1.5 text-xs">
        <div class="flex flex-wrap items-baseline gap-2">
          <dt class="text-fg-muted w-36 shrink-0">Authorization endpoint</dt>
          <dd class="font-mono break-all">
            {diagnostics.endpoints.authorization_endpoint?.value ??
              (diagnostics.discovering ? 'discovering…' : 'not discovered')}
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
            {scopesToSend}
          </dd>
        </div>
      </dl>

      {#if scopeAdjustment.changes.length > 0}
        <div class="border-border mt-3 border-t pt-3">
          <p class="text-sm font-medium">Scope adjustment</p>
          <ul class="text-fg-muted mt-1 list-inside list-disc space-y-0.5 text-xs">
            {#each scopeAdjustment.changes as change, i (i)}
              <li class:line-through={verbatimScopes}><Markdown text={change} inline /></li>
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

      {#if diagnostics.discovering}
        <Alert severity="info">
          <p role="status">Reading the discovery documents&hellip;</p>
        </Alert>
      {:else if !diagnostics.endpoints.authorization_endpoint && mode === 'ehr' && iss}
        <Alert severity="warning" title="The launch's server published no authorization endpoint">
          <p>
            Swiss read the discovery documents at
            <code class="font-mono text-xs break-all">{iss}</code> and none of them named one, so this
            launch cannot start. For an EHR launch Swiss only uses what the launch&rsquo;s own server
            publishes.
          </p>
          {#if diagnostics.configuredIssuerSkipped}
            <p class="mt-2">
              The configured authorization server,
              <code class="font-mono text-xs break-all">{config.current.authIssuer}</code>, was not
              asked instead: the launch did not name it, and sending the launch there would hand its
              token to a server that did not issue it.
            </p>
          {/if}
          <p class="mt-2">
            The exchange log shows what each request returned. A server that cannot be reached from
            the browser is usually a CORS or network problem on that server.
          </p>
          <button
            type="button"
            class="border-warning text-warning mt-2 rounded border px-2 py-1 text-xs"
            onclick={() => void diagnostics.discover()}
          >
            Try again
          </button>
        </Alert>
      {:else if !diagnostics.endpoints.authorization_endpoint}
        <Alert severity="warning" title="No authorization endpoint was discovered">
          <p>
            Swiss read the discovery documents when this page opened and none of them named one, so
            a launch cannot start.
            <a class="underline" href="/diagnostics">Run diagnostics</a> to see which documents were
            reachable, or check the FHIR base and authorization server on
            <a class="underline" href="/config">Config</a>.
          </p>
          <button
            type="button"
            class="border-warning text-warning mt-2 rounded border px-2 py-1 text-xs"
            onclick={() => void diagnostics.discover()}
          >
            Try again
          </button>
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
          class="bg-primary text-on-primary rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          disabled={starting || !canUseS256() || (mode === 'ehr' && !iss)}
          onclick={() => void start(false)}
        >
          {starting ? 'Starting…' : 'Start launch'}
        </button>
        <button
          type="button"
          class="border-border-control text-fg-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={starting}
          onclick={() => void start(true)}
        >
          Preview the URL
        </button>
      </div>

      {#if preview}
        <div class="mt-3">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium">Authorization URL</p>
            <span class="ml-auto"><CopyButton value={preview} label="Copy URL" /></span>
          </div>
          <pre
            class="bg-bg border-border mt-1 max-h-48 overflow-auto rounded border p-2 font-mono text-[11px] break-all whitespace-pre-wrap">{preview}</pre>
          <p class="text-fg-muted mt-1 text-xs">
            This is a real launch, saved in this tab. Opening the URL <em>in this tab</em> within ten
            minutes completes it. It will not complete in another tab or browser: the PKCE verifier is
            kept in this tab&rsquo;s session storage, so the callback there finds no launch to match.
            Previewing again, or starting the launch, makes a new one.
          </p>
        </div>
      {/if}
    </Card>
  {/if}
</div>
