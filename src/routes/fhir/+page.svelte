<script lang="ts">
  import { onMount } from 'svelte';
  import { config } from '$lib/config/config.svelte';
  import { session } from '$lib/auth/session.svelte';
  import {
    describeResult,
    fhirRequest,
    type FhirMethod,
    type FhirResponse
  } from '$lib/fhir/client';
  import { patientEverythingQuery, patientReadQuery, patientWithEobQuery } from '$lib/fhir/url';
  import { CORS_HINT, isAuthorizationIssue } from '$lib/fhir/operation-outcome';
  import Alert from '$lib/components/ui/Alert.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import HeaderEditor from '$lib/components/HeaderEditor.svelte';
  import JsonTree from '$lib/components/JsonTree.svelte';

  const METHODS: FhirMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const WRITE_METHODS: FhirMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

  /** The same localStorage keys the Angular app used, so settings carry over. */
  const PERSIST_HEADERS_KEY = 'persistCurrentHeaders';
  const PERSIST_AUTH_KEY = 'persistAuthorizationHeader';

  let method = $state<FhirMethod>('GET');
  // Starts empty and stays empty. The input's placeholder shows the expected
  // shape instead of prefilling a value the user then has to delete.
  let query = $state('');
  let body = $state('');
  let headers = $state<Record<string, string>>({});
  let authorize = $state(true);
  let enableWrites = $state(false);

  let loading = $state(false);
  let response = $state<FhirResponse | null>(null);
  let error = $state<string | null>(null);
  let viewRaw = $state(false);
  let sentUrl = $state<string | null>(null);
  let configAtResult = $state<string | null>(null);

  let controller: AbortController | null = null;

  const patientId = $derived(session.context?.patient.value ?? '');

  const bodyJsonError = $derived.by(() => {
    if (!body.trim()) return null;
    try {
      JSON.parse(body);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  });

  const needsBody = $derived(['POST', 'PUT', 'PATCH'].includes(method));
  const isWrite = $derived(WRITE_METHODS.includes(method));
  const blocked = $derived(isWrite && !enableWrites);

  /**
   * A query is required, except for a write with a body: POSTing a
   * transaction or batch Bundle goes to the FHIR base itself, with no path.
   */
  function hasTarget(q: string, m: FhirMethod): boolean {
    return q.trim() !== '' || (['POST', 'PUT', 'PATCH'].includes(m) && body.trim() !== '');
  }

  const resultSummary = $derived(response?.json ? describeResult(response.json) : null);

  /** Warns when the FHIR base moved after a result was rendered. */
  const configChangedSinceResult = $derived(
    configAtResult !== null && configAtResult !== config.current.fhirBaseUrl
  );

  // Defaults to ON, because attaching the token is what you want almost
  // every time. Only an explicit "off" is remembered -- reading the Angular
  // key's mere presence would force it off for anyone without a stored
  // preference, which is the opposite of the useful default. The legacy
  // "checked" value is still honoured so an existing preference carries over.
  onMount(() => {
    try {
      const stored = localStorage.getItem(PERSIST_AUTH_KEY);
      if (stored === 'off') authorize = false;
      else if (stored === 'checked' || stored === 'on') authorize = true;
    } catch {
      /* storage unavailable; keep the default */
    }
  });

  function rememberAuthPreference(on: boolean) {
    authorize = on;
    try {
      localStorage.setItem(PERSIST_AUTH_KEY, on ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
  }

  async function send(overrideQuery?: string, overrideMethod?: FhirMethod) {
    const q = overrideQuery ?? query;
    const m = overrideMethod ?? method;
    if (!hasTarget(q, m)) return;

    controller?.abort();
    controller = new AbortController();

    loading = true;
    error = null;
    response = null;

    try {
      const result = await fhirRequest({
        method: m,
        query: q,
        base: config.current.fhirBaseUrl,
        headers,
        body: needsBody && body.trim() ? body : undefined,
        accessToken: session.accessToken,
        authorize,
        signal: controller.signal
      });
      response = result;
      sentUrl = result.exchange.request.url;
      configAtResult = config.current.fhirBaseUrl;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      // Single flag cleared in `finally`. The Angular version cleared it from
      // three separate 500ms setTimeouts that could overlap and race.
      loading = false;
      controller = null;
    }
  }

  function cancel() {
    controller?.abort();
    loading = false;
  }
</script>

<div class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">FHIR API</h1>
    <p class="text-fg-muted mt-1 text-sm">
      Send requests to <code class="font-mono text-xs"
        >{config.current.fhirBaseUrl || '(no FHIR base configured)'}</code
      >. Relative paths resolve against the base; an absolute URL is used as-is.
    </p>
  </header>

  {#if !session.isAuthenticated}
    <Alert severity="info" title="No access token">
      <p>
        Requests will be sent unauthenticated. That is a legitimate test &mdash; a server should
        reject anonymous access &mdash; but for real queries you will want to
        <a class="underline" href="/launch">start a launch</a> first.
      </p>
    </Alert>
  {:else if session.isExpired}
    <Alert severity="warning" title="The access token has expired">
      <p>
        Requests will probably be rejected. <a class="underline" href="/">Refresh it</a> first.
      </p>
    </Alert>
  {/if}

  <Card title="Request">
    <div class="space-y-3">
      <div class="flex flex-wrap gap-2">
        <select
          bind:value={method}
          class="border-border bg-bg rounded-md border px-2 py-1.5 font-mono text-sm"
          aria-label="HTTP method"
        >
          {#each METHODS as m (m)}
            <option value={m}>{m}</option>
          {/each}
        </select>
        <input
          type="text"
          bind:value={query}
          placeholder="Patient?_id=patient-a"
          spellcheck="false"
          onkeydown={(e) => {
            if (e.key === 'Enter' && !blocked) void send();
          }}
          class="border-border bg-bg min-w-48 flex-1 rounded-md border px-2 py-1.5 font-mono text-sm"
          aria-label="FHIR query"
        />
        {#if loading}
          <button
            type="button"
            class="border-border text-fg-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm"
            onclick={cancel}
          >
            Cancel
          </button>
        {:else}
          <button
            type="button"
            class="bg-primary rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            disabled={!hasTarget(query, method) || blocked || Boolean(needsBody && bodyJsonError)}
            onclick={() => void send()}
          >
            Send
          </button>
        {/if}
      </div>

      <label class="text-fg-muted flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={authorize}
          onchange={(e) => rememberAuthPreference(e.currentTarget.checked)}
          class="accent-primary h-3.5 w-3.5"
        />
        Attach the bearer token
        {#if Object.keys(headers).some((h) => h.toLowerCase() === 'authorization')}
          <span class="text-warning">
            &mdash; your own Authorization header takes precedence over this
          </span>
        {/if}
      </label>

      <HeaderEditor onChange={(h) => (headers = h)} persistKey={PERSIST_HEADERS_KEY} />

      {#if isWrite}
        <div class="border-warning/40 bg-warning/5 rounded-md border px-3 py-2">
          <label class="flex cursor-pointer items-center gap-2 text-xs">
            <input type="checkbox" bind:checked={enableWrites} class="accent-primary h-3.5 w-3.5" />
            <span class="text-warning font-medium">
              Enable write operations against {config.current.fhirBaseUrl}
            </span>
          </label>
          <p class="text-fg-muted mt-1 text-xs">
            {method} can create, change or remove data on the server. Off by default so a mutation is
            always deliberate.
          </p>
        </div>
      {/if}

      {#if needsBody}
        <div>
          <label for="fhir-body" class="text-sm font-medium">Request body</label>
          <textarea
            id="fhir-body"
            bind:value={body}
            rows="8"
            spellcheck="false"
            placeholder={'{\n  "resourceType": "Patient",\n  "name": [{ "family": "Wonka" }]\n}'}
            class="border-border bg-bg mt-1 w-full rounded-md border px-2 py-1.5 font-mono text-xs"
          ></textarea>
          {#if bodyJsonError}
            <p class="text-error mt-1 text-xs">Invalid JSON: {bodyJsonError}</p>
          {/if}
          <p class="text-fg-muted mt-1 text-xs">
            Leave the query empty to send this to the FHIR base itself, which is where a transaction
            or batch <code class="font-mono">Bundle</code> goes.
          </p>
        </div>
      {/if}
    </div>
  </Card>

  <Card title="Quick queries" subtitle="Common requests for the patient in the launch context.">
    {#if !patientId}
      <p class="text-fg-muted text-sm">
        These need a patient in the launch context. Request the
        <code class="font-mono text-xs">launch/patient</code> scope and start a launch, or type a query
        above.
      </p>
    {:else}
      <p class="text-fg-muted mb-2 text-xs">
        Using patient <code class="font-mono">{patientId}</code> from the launch context.
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-md bg-yellow-400 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-yellow-300 disabled:opacity-50"
          disabled={loading}
          onclick={() => {
            method = 'GET';
            query = patientReadQuery(patientId);
            void send(query, 'GET');
          }}
        >
          Patient
        </button>
        <button
          type="button"
          class="rounded-md bg-yellow-400 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-yellow-300 disabled:opacity-50"
          disabled={loading}
          onclick={() => {
            method = 'GET';
            query = patientWithEobQuery(patientId);
            void send(query, 'GET');
          }}
        >
          Patient + ExplanationOfBenefit
        </button>
        <button
          type="button"
          class="rounded-md bg-yellow-400 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-yellow-300 disabled:opacity-50"
          disabled={loading}
          onclick={() => {
            method = 'GET';
            query = patientEverythingQuery(patientId);
            void send(query, 'GET');
          }}
        >
          $everything
        </button>
      </div>
    {/if}
  </Card>

  <Card title="Response">
    {#snippet actions()}
      {#if response?.json}
        <div class="flex gap-2">
          <button
            type="button"
            class="border-border text-fg-muted hover:text-fg rounded border px-2 py-1 text-xs"
            onclick={() => (viewRaw = !viewRaw)}
          >
            {viewRaw ? 'Tree' : 'Raw'}
          </button>
          {#if response.nextPage}
            <button
              type="button"
              class="bg-primary rounded border px-2 py-1 text-xs text-white"
              onclick={() => void send(response?.nextPage ?? '', 'GET')}
            >
              Next page
            </button>
          {/if}
        </div>
      {/if}
    {/snippet}

    {#if loading}
      <div class="bg-surface-2 h-1.5 w-full overflow-hidden rounded">
        <div class="bg-secondary h-full w-1/3 animate-pulse rounded"></div>
      </div>
      <p class="text-fg-muted mt-2 text-sm">Sending&hellip;</p>
    {:else if error}
      <Alert severity="error" title="The request could not be built">
        <p>{error}</p>
      </Alert>
    {:else if !response}
      <p class="text-fg-muted text-sm">
        No request sent yet. Type a query above, or use a quick query.
      </p>
    {:else}
      <div class="space-y-3">
        <div class="flex flex-wrap items-baseline gap-3 text-xs">
          <span
            class="rounded px-1.5 py-0.5 font-mono {response.ok
              ? 'text-success border-success/40 border'
              : 'text-error border-error/40 border'}"
          >
            {response.status ?? response.exchange.outcome}
          </span>
          <span class="text-fg-muted font-mono">{response.durationMs}ms</span>
          {#if resultSummary}
            <span class="text-fg-muted">{resultSummary}</span>
          {/if}
        </div>

        {#if sentUrl}
          <p class="text-fg-muted font-mono text-[11px] break-all">{sentUrl}</p>
        {/if}

        {#if configChangedSinceResult}
          <Alert severity="info">
            <p>
              The FHIR base URL changed after this result was fetched, so it came from
              <code class="font-mono text-xs">{configAtResult}</code>.
            </p>
          </Alert>
        {/if}

        {#if response.exchange.outcome === 'network-or-cors' || response.exchange.outcome === 'blocked-precondition'}
          <Alert severity="error" title="The request did not complete">
            {#if response.exchange.diagnosis}
              <ul class="mt-1 list-inside list-disc space-y-0.5">
                {#each response.exchange.diagnosis.evidence as e (e)}
                  <li>{e}</li>
                {/each}
              </ul>
            {/if}
            <p class="mt-2">{CORS_HINT}</p>
            <p class="mt-2">
              <a class="underline" href="/diagnostics">Run diagnostics</a> for a targeted check.
            </p>
          </Alert>
        {/if}

        {#if response.issues.length > 0}
          <div class="space-y-2">
            {#each response.issues as issue, i (i)}
              <Alert severity={issue.severity === 'warning' ? 'warning' : 'error'}>
                <p>
                  <span class="font-mono text-xs">{issue.severity}/{issue.code}</span>
                  {#if issue.diagnostics || issue.details}
                    &mdash; {issue.diagnostics ?? issue.details}
                  {/if}
                </p>
                {#if issue.expression?.length}
                  <p class="mt-0.5 font-mono text-xs">at {issue.expression.join(', ')}</p>
                {/if}
              </Alert>
            {/each}

            {#if isAuthorizationIssue(response.issues)}
              <Alert severity="info" title="This may be your granted scopes, not a server fault">
                <p>
                  The outcome reports a security or forbidden code, which usually means the token
                  does not carry the permission this request needs.
                  <a class="underline" href="/">Check what you were actually granted</a>.
                </p>
              </Alert>
            {/if}
          </div>
        {/if}

        {#if response.json !== undefined}
          {#if viewRaw}
            <pre
              class="bg-bg border-border max-h-[32rem] overflow-auto rounded border p-2 font-mono text-[11px]">{JSON.stringify(
                response.json,
                null,
                2
              )}</pre>
          {:else}
            <div class="bg-bg border-border max-h-[32rem] overflow-auto rounded border p-2">
              <JsonTree value={response.json} depth={2} />
            </div>
          {/if}
        {:else if response.text}
          <div>
            <p class="text-fg-muted mb-1 text-xs">
              The server did not return JSON. Showing the raw body.
            </p>
            <pre
              class="bg-bg border-border max-h-64 overflow-auto rounded border p-2 font-mono text-[11px] whitespace-pre-wrap">{response.text.slice(
                0,
                20000
              )}</pre>
          </div>
        {/if}
      </div>
    {/if}
  </Card>
</div>
