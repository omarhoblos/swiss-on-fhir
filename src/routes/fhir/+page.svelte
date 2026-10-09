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
  import { onMount, untrack } from 'svelte';
  import { config } from '$lib/config/config.svelte';
  import { session } from '$lib/auth/session.svelte';
  import {
    describeResult,
    fhirRequest,
    hasHeader,
    type FhirMethod,
    type FhirResponse
  } from '$lib/fhir/client';
  import {
    buildFhirUrl,
    patientEverythingQuery,
    patientReadQuery,
    patientWithEobQuery
  } from '$lib/fhir/url';
  import { SvelteMap } from 'svelte/reactivity';
  import { readServerName, requestBaseOf, requestTitle } from '$lib/fhir/server-name';
  import { isCleartextRemote, originOf } from '$lib/url';
  import { isSecretHeader } from '$lib/http/exchange';
  import { CORS_HINT, isAuthorizationIssue } from '$lib/fhir/operation-outcome';
  import Alert from '$lib/components/ui/Alert.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import HeaderEditor from '$lib/components/HeaderEditor.svelte';
  import JsonTree from '$lib/components/JsonTree.svelte';
  import SearchInput from '$lib/components/ui/SearchInput.svelte';
  import ToggleSwitch from '$lib/components/ui/ToggleSwitch.svelte';
  import { FHIR_MIME, xmlSyntaxError, type BodyFormat } from '$lib/fhir/xml';
  import { searchJson } from '$lib/fhir/search';
  import { searchXml } from '$lib/fhir/xml-tree';
  import XmlTree from '$lib/components/XmlTree.svelte';
  import { CURRENT_HIGHLIGHT, findText, paintHighlight, SEARCH_HIGHLIGHT } from '$lib/highlight';

  const METHODS: FhirMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const FORMATS = [
    { value: 'json', label: 'JSON' },
    { value: 'xml', label: 'XML' }
  ] as const satisfies readonly [
    { value: BodyFormat; label: string },
    { value: BodyFormat; label: string }
  ];
  const FORMAT_NAME: Record<BodyFormat, string> = { json: 'JSON', xml: 'XML' };
  const BODY_PLACEHOLDER: Record<BodyFormat, string> = {
    json: '{\n  "resourceType": "Patient",\n  "name": [{ "family": "Wonka" }]\n}',
    xml: '<Patient xmlns="http://hl7.org/fhir">\n  <name>\n    <family value="Wonka"/>\n  </name>\n</Patient>'
  };
  const WRITE_METHODS: FhirMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

  /** The same localStorage keys the Angular app used, so settings carry over. */
  const PERSIST_HEADERS_KEY = 'persistCurrentHeaders';
  const PERSIST_AUTH_KEY = 'persistAuthorizationHeader';

  let method = $state<FhirMethod>('GET');
  // Starts empty and stays empty. The input's placeholder shows the expected
  // shape instead of prefilling a value the user then has to delete.
  let query = $state('');
  let body = $state('');
  /**
   * The format the body is typed in, and the one responses are asked for.
   * Both start as JSON. Switching the body's format does not convert what is
   * typed: that needs the FHIR type model, and a body that is not what the
   * user wrote is not a test of the server.
   */
  let bodyFormat = $state<BodyFormat>('json');
  let responseFormat = $state<BodyFormat>('json');
  let headers = $state<Record<string, string>>({});
  let authorize = $state(true);
  let enableWrites = $state(false);
  /** Per-page, never remembered: sending the token elsewhere is a deliberate act each time. */
  let allowCrossOriginToken = $state(false);

  /**
   * The FHIR base requests resolve against, and the only origin the bearer
   * token is sent to without asking.
   *
   * With a session it is the base the token was issued for, taken from the
   * snapshot made at sign-in -- not the configured base, which can change
   * underneath a session: by an edit, or by an EHR launch link overriding it.
   * Following the configuration here is how a token issued by one server got
   * sent to another.
   */
  const sessionBase = $derived(session.current?.configSnapshot.fhirBaseUrl ?? '');
  const base = $derived(sessionBase || config.current.fhirBaseUrl);
  const baseDiffersFromConfig = $derived(
    sessionBase !== '' &&
      config.current.fhirBaseUrl !== '' &&
      sessionBase !== config.current.fhirBaseUrl
  );

  /** Where the typed query will actually go, or null while it cannot be resolved. */
  const targetOrigin = $derived.by(() => {
    try {
      return buildFhirUrl(base, query).origin;
    } catch {
      return null;
    }
  });
  const crossOriginTarget = $derived(targetOrigin !== null && targetOrigin !== originOf(base));

  /** Header names the user added that carry a credential, and follow the token's rule. */
  const credentialHeaders = $derived(Object.keys(headers).filter(isSecretHeader));
  const sendsToken = $derived(authorize && Boolean(session.accessToken));

  /** Credentials on this request would cross a network in the clear. Said, not refused. */
  const cleartextCredentials = $derived(
    targetOrigin !== null &&
      isCleartextRemote(targetOrigin) &&
      (sendsToken || credentialHeaders.length > 0)
  );

  /**
   * Server names from their CapabilityStatements, by FHIR base, for the
   * Request card's title. The title follows the request bar: an absolute URL
   * on another server, such as `https://server.fire.ly/r4/Patient`, names
   * that server, not the configured one. While a server is unread, or when
   * it does not say, the card is just "Request".
   */
  const serverNames = new SvelteMap<string, string | null>();
  const requestBase = $derived(requestBaseOf(query, base));
  const serverName = $derived(serverNames.get(requestBase) ?? null);

  function learnServerName(target: string, signal: AbortSignal) {
    // Untracked: a refresh replaces the token without changing the server,
    // and should not ask again.
    const accessToken = untrack(() => session.accessToken);
    void readServerName({ base: target, tokenBase: base, accessToken, signal }).then((name) => {
      if (!signal.aborted) serverNames.set(target, name);
    });
  }

  // The base requests go to is read when the page opens, and again when it
  // changes or the user signs in or out.
  const signedIn = $derived(Boolean(session.accessToken));
  $effect(() => {
    const target = base;
    void signedIn;
    if (!target) return;
    const controller = new AbortController();
    learnServerName(target, controller.signal);
    return () => controller.abort();
  });

  let loading = $state(false);
  let response = $state<FhirResponse | null>(null);

  /**
   * The other origin something was, or would be, held back from: the typed
   * target, or where the last request went when a server's next link took
   * it elsewhere -- which the typed query alone never shows.
   */
  const otherOrigin = $derived(
    crossOriginTarget && (sendsToken || credentialHeaders.length > 0)
      ? targetOrigin
      : (response?.tokenWithheld ?? response?.credentialsWithheld?.origin ?? null)
  );

  let error = $state<string | null>(null);
  let viewRaw = $state(false);
  /**
   * Levels of the response tree open: every level by default, so a response
   * reads top to bottom without clicking, and only the top after "Collapse
   * all". The tree renders a node's children only while it is open, so a
   * very large Bundle is quicker to look through collapsed. Each new response
   * starts at the default again.
   */
  const TREE_DEPTH = Infinity;
  let treeDepth = $state(TREE_DEPTH);
  const expandedAll = $derived(treeDepth === Infinity);

  /**
   * Searching the response. The tree shows only the branches leading to a
   * match, opened down to it; the raw view and a non-JSON body keep their
   * text and mark the matches. Enter steps through them. The query is kept
   * across responses, so the next page of a search can be checked for the
   * same thing, and it is applied a moment after typing stops, since a large
   * Bundle is walked on every change.
   */
  let responseQuery = $state('');
  let appliedQuery = $state('');
  $effect(() => {
    const query = responseQuery.trim().toLowerCase();
    const id = setTimeout(() => (appliedQuery = query), 150);
    return () => clearTimeout(id);
  });
  const treeSearch = $derived.by(() => {
    if (!appliedQuery || viewRaw) return undefined;
    if (response?.json !== undefined) return searchJson(response.json, appliedQuery);
    if (response?.xml?.tree) return searchXml(response.xml.tree, appliedQuery);
    return undefined;
  });
  /** The response can be shown as a tree: JSON, or XML that was built into one. */
  const hasTree = $derived(response?.json !== undefined || Boolean(response?.xml?.tree));
  let responseBody = $state<HTMLElement>();
  let matches = $state<Range[]>([]);
  let currentMatch = $state(-1);

  $effect(() => {
    // Re-run whenever what is on screen changes.
    void [response, viewRaw, treeDepth, treeSearch];
    const found = responseBody && appliedQuery ? findText(responseBody, [appliedQuery]) : [];
    matches = found;
    currentMatch = -1;
    return paintHighlight(SEARCH_HIGHLIGHT, found);
  });

  $effect(() => {
    const range = matches[currentMatch];
    if (!range) return;
    range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    return paintHighlight(CURRENT_HIGHLIGHT, [range]);
  });

  const searchStatus = $derived.by(() => {
    if (!appliedQuery) return '';
    if (matches.length === 0) return `No matches for “${responseQuery.trim()}”.`;
    if (currentMatch >= 0) {
      return `Match ${currentMatch + 1} of ${matches.length}. Enter for the next, Shift+Enter for the previous.`;
    }
    return `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}. Enter steps through them.`;
  });

  function onResponseSearchKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && matches.length > 0) {
      event.preventDefault();
      const step = event.shiftKey ? -1 : 1;
      currentMatch = (currentMatch + step + matches.length) % matches.length;
    } else if (event.key === 'Escape' && responseQuery) {
      event.preventDefault();
      responseQuery = '';
    }
  }
  let sentUrl = $state<string | null>(null);
  let configAtResult = $state<string | null>(null);

  let controller: AbortController | null = null;
  /** The last request was cancelled before it answered. */
  let cancelled = $state(false);

  const patientId = $derived(session.context?.patient.value ?? '');

  const bodyError = $derived.by(() => {
    if (!body.trim()) return null;
    if (bodyFormat === 'xml') return xmlSyntaxError(body);
    try {
      JSON.parse(body);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  });

  /** The body looks like the other format. Offered as a switch, never guessed. */
  const bodyLooksLike = $derived.by((): BodyFormat | null => {
    const start = body.trimStart();
    if (bodyFormat === 'json' && start.startsWith('<')) return 'xml';
    if (bodyFormat === 'xml' && (start.startsWith('{') || start.startsWith('['))) return 'json';
    return null;
  });

  // The user's own header is what gets sent; the switches say so.
  const ownAccept = $derived(hasHeader(headers, 'accept'));
  const ownContentType = $derived(hasHeader(headers, 'content-type'));

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

  const resultSummary = $derived.by(() => {
    const resource = response?.json ?? response?.xml?.outline;
    return resource ? describeResult(resource) : null;
  });

  /** What the last request was, so switching the response format can ask again. */
  let lastSent = $state<{ query: string; method: FhirMethod } | null>(null);
  /** The format the last request asked for, or null when the user's own Accept was sent. */
  let askedFor = $state<BodyFormat | null>(null);
  /** Why switching the response format did not send anything. */
  let formatNote = $state<string | null>(null);

  const receivedFormat = $derived(
    response?.json !== undefined ? 'json' : response?.xml ? 'xml' : null
  );
  /** The server answered in another format than the one asked for, said plainly. */
  const formatMismatch = $derived.by(() => {
    if (askedFor === null || receivedFormat === null || receivedFormat === askedFor) return null;
    const contentType = response?.exchange.response?.headers?.['content-type'];
    const sent = contentType ? ` (Content-Type: ${contentType})` : '';
    return `Asked for ${FORMAT_NAME[askedFor]}; the server answered with ${FORMAT_NAME[receivedFormat]}${sent}. It may not support ${FORMAT_NAME[askedFor]}.`;
  });

  /**
   * Switching the response format asks again in that format. Only a GET is
   * repeated: sending a POST, PUT, PATCH or DELETE again to see its answer
   * in another format could change data on the server a second time.
   */
  function chooseResponseFormat(format: BodyFormat) {
    if (format === responseFormat) return;
    responseFormat = format;
    formatNote = null;
    if (!lastSent) return;
    if (lastSent.method === 'GET') {
      void send(lastSent.query, 'GET');
      return;
    }
    formatNote = `${FORMAT_NAME[format]} applies from the next request. The last one was a ${lastSent.method}, which is not sent again: it could change data on the server.`;
  }

  /** Warns when the FHIR base moved after a result was rendered. */
  const configChangedSinceResult = $derived(configAtResult !== null && configAtResult !== base);

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
    const mine = new AbortController();
    controller = mine;

    // Another server is read only when a request is sent to it, never while
    // its URL is being typed: a pause mid-word would ask a half-typed host.
    const target = requestBaseOf(q, base);
    if (target !== base && !serverNames.get(target)) learnServerName(target, mine.signal);

    lastSent = { query: q, method: m };
    askedFor = ownAccept ? null : responseFormat;
    formatNote = null;
    loading = true;
    error = null;
    response = null;
    treeDepth = TREE_DEPTH;
    cancelled = false;

    try {
      const result = await fhirRequest({
        method: m,
        query: q,
        base,
        tokenBase: base,
        headers,
        body: needsBody && body.trim() ? body : undefined,
        bodyFormat,
        accept: responseFormat,
        accessToken: session.accessToken,
        authorize,
        allowCrossOriginToken,
        signal: mine.signal
      });
      // Cancelled, or replaced by a newer request, while this one was in
      // flight. Its result is not the one on screen; it used to overwrite
      // the newer request's with a cancelled one.
      if (mine.signal.aborted) return;
      response = result;
      sentUrl = result.exchange.request.url;
      configAtResult = base;
    } catch (cause) {
      if (mine.signal.aborted) return;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      // Single flag cleared in `finally`. The Angular version cleared it from
      // three separate 500ms setTimeouts that could overlap and race. Only
      // this request's own: a superseded one finishing must not clear the
      // loading state of the request that replaced it.
      if (controller === mine) {
        loading = false;
        controller = null;
      }
    }
  }

  function cancel() {
    controller?.abort();
    controller = null;
    loading = false;
    cancelled = true;
  }
</script>

<div class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">FHIR API</h1>
    <p class="text-fg-muted mt-1 text-sm">
      Send requests to <code class="font-mono text-xs">{base || '(no FHIR base configured)'}</code>.
      Relative paths resolve against the base; an absolute URL is used as-is.
    </p>
  </header>

  {#if baseDiffersFromConfig}
    <Alert severity="warning" title="Using the FHIR base this session was issued for">
      <p>
        The token was issued for <code class="font-mono text-xs break-all">{sessionBase}</code>, so
        requests go there. The configured FHIR base is
        <code class="font-mono text-xs break-all">{config.current.fhirBaseUrl}</code>; to query it,
        <a class="underline" href="/launch">start a launch</a> against it, or type an absolute URL. The
        token is withheld from any other origin unless you allow it below.
      </p>
    </Alert>
  {/if}

  {#if !session.isAuthenticated}
    <Alert severity="info" title="No access token">
      <p>
        Requests will be sent unauthenticated. For anonymous access this is fine. For testing
        authenticated queries, <a class="underline" href="/launch">start a launch</a> first.
      </p>
    </Alert>
  {:else if session.isExpired}
    <Alert severity="warning" title="The access token has expired">
      <p>
        Requests will probably be rejected. <a class="underline" href="/">Refresh it</a> first.
      </p>
    </Alert>
  {/if}

  <Card title={requestTitle(serverName)}>
    <div class="space-y-3">
      <div class="flex flex-wrap gap-2">
        <select
          bind:value={method}
          class="border-border-control bg-bg rounded-md border py-1.5 pr-7 pl-2 font-mono text-sm"
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
          class="border-border-control bg-bg min-w-48 flex-1 rounded-md border px-2 py-1.5 font-mono text-sm"
          aria-label="FHIR query"
        />
        {#if loading}
          <button
            type="button"
            class="border-border-control text-fg-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm"
            onclick={cancel}
          >
            Cancel
          </button>
        {:else}
          <button
            type="button"
            class="bg-primary text-on-primary rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            disabled={!hasTarget(query, method) || blocked || Boolean(needsBody && bodyError)}
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
      {#if otherOrigin}
        <label class="text-warning flex cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            bind:checked={allowCrossOriginToken}
            class="accent-primary mt-0.5 h-3.5 w-3.5"
          />
          <span>
            <span class="font-medium">{otherOrigin}</span> is not the FHIR base, so the bearer token and
            your credential headers will not be sent there unless you tick this. Sending them hands them
            to that origin.
          </span>
        </label>
      {/if}
      {#if response?.tokenWithheld}
        <p class="text-warning text-xs">
          The bearer token was not sent: <span class="font-mono">{response.tokenWithheld}</span> is not
          the FHIR base. Tick the box above to send it there anyway.
        </p>
      {/if}
      {#if response?.credentialsWithheld}
        <p class="text-warning text-xs">
          Not sent: your <span class="font-mono"
            >{response.credentialsWithheld.headers.join(', ')}</span
          >
          {response.credentialsWithheld.headers.length === 1 ? 'header' : 'headers'}, because
          <span class="font-mono">{response.credentialsWithheld.origin}</span> is not the FHIR base.
          Tick the box above to send {response.credentialsWithheld.headers.length === 1
            ? 'it'
            : 'them'} there anyway.
        </p>
      {/if}
      {#if cleartextCredentials}
        <p class="text-warning text-xs">
          <span class="font-mono">{targetOrigin}</span> is plain http, so the bearer token and any credential
          headers on this request can be read by anyone on the network between you and it.
        </p>
      {/if}

      <HeaderEditor onChange={(h) => (headers = h)} persistKey={PERSIST_HEADERS_KEY} />

      {#if isWrite}
        <div class="border-warning/40 bg-warning/5 rounded-md border px-3 py-2">
          <label class="flex cursor-pointer items-center gap-2 text-xs">
            <input type="checkbox" bind:checked={enableWrites} class="accent-primary h-3.5 w-3.5" />
            <span class="text-warning font-medium">
              Enable write operations against {base}
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
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label for="fhir-body" class="text-sm font-medium">Request body</label>
            <ToggleSwitch
              value={bodyFormat}
              options={FORMATS}
              label="Body format"
              onchange={(f) => (bodyFormat = f)}
            />
          </div>
          <textarea
            id="fhir-body"
            bind:value={body}
            rows="8"
            spellcheck="false"
            placeholder={BODY_PLACEHOLDER[bodyFormat]}
            class="border-border-control bg-bg mt-1 w-full rounded-md border px-2 py-1.5 font-mono text-xs"
          ></textarea>
          {#if bodyLooksLike}
            <p class="text-error mt-1 text-xs">
              This looks like {FORMAT_NAME[bodyLooksLike]}, not {FORMAT_NAME[bodyFormat]}.
              <button
                type="button"
                class="text-fg underline"
                onclick={() => (bodyFormat = bodyLooksLike ?? bodyFormat)}
              >
                Switch to {FORMAT_NAME[bodyLooksLike]}
              </button>
            </p>
          {:else if bodyError}
            <p class="text-error mt-1 text-xs">Invalid {FORMAT_NAME[bodyFormat]}: {bodyError}</p>
          {/if}
          {#if ownContentType}
            <p class="text-warning mt-1 text-xs">
              Your own Content-Type header is sent, not
              <code class="font-mono">{FHIR_MIME[bodyFormat]}</code>.
            </p>
          {/if}
          <p class="text-fg-muted mt-1 text-xs">
            Leave the query empty to send this to the FHIR base itself, which is where a transaction
            or batch <code class="font-mono">Bundle</code> goes.
          </p>
        </div>
      {/if}
    </div>
  </Card>

  {#snippet quick(label: string, q: string)}
    <button
      type="button"
      class="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:brightness-105 disabled:opacity-50"
      disabled={loading}
      onclick={() => {
        method = 'GET';
        query = q;
        void send(q, 'GET');
      }}
    >
      {label}
    </button>
  {/snippet}

  <Card title="Quick queries" subtitle="Common requests, sent with one click.">
    <div class="flex flex-wrap gap-2">
      <!-- The server's CapabilityStatement: needs no patient, and no token
           on most servers, so it is the first thing worth asking. -->
      {@render quick('metadata', 'metadata')}
      {#if patientId}
        {@render quick('Patient', patientReadQuery(patientId))}
        {@render quick('Patient + ExplanationOfBenefit', patientWithEobQuery(patientId))}
        {@render quick('$everything', patientEverythingQuery(patientId))}
      {/if}
    </div>
    {#if patientId}
      <p class="text-fg-muted mt-2 text-xs">
        Patient queries use <code class="font-mono">{patientId}</code> from the launch context.
      </p>
    {:else}
      <p class="text-fg-muted mt-2 text-xs">
        Patient queries need a patient in the launch context. Request the
        <code class="font-mono">launch/patient</code> scope and start a launch, or type a query above.
      </p>
    {/if}
  </Card>

  <Card title="Response" sticky>
    {#snippet actions()}
      <div class="flex flex-wrap items-center justify-end gap-2">
        {#if hasTree}
          <button
            type="button"
            class="border-border-control text-fg-muted hover:text-fg rounded border px-2 py-1 text-xs"
            onclick={() => (viewRaw = !viewRaw)}
          >
            {viewRaw ? 'Tree' : 'Raw'}
          </button>
          {#if !viewRaw}
            <button
              type="button"
              class="border-border-control text-fg-muted hover:text-fg rounded border px-2 py-1 text-xs"
              onclick={() => (treeDepth = expandedAll ? 1 : Infinity)}
            >
              {expandedAll ? 'Collapse all' : 'Expand all'}
            </button>
          {/if}
        {/if}
        {#if response?.nextPage}
          <button
            type="button"
            class="bg-primary text-on-primary rounded border px-2 py-1 text-xs"
            onclick={() => void send(response?.nextPage ?? '', 'GET')}
          >
            Next page
          </button>
        {/if}
        <ToggleSwitch
          value={responseFormat}
          options={FORMATS}
          label="Response format"
          onchange={chooseResponseFormat}
        />
      </div>
    {/snippet}

    <!-- Stays in view while the response scrolls: what was asked, what came
         back, and the search over it. -->
    {#snippet head()}
      {#if response && !loading && !error}
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

          {#if response.json !== undefined || response.text}
            <div role="search">
              <SearchInput
                bind:value={responseQuery}
                onkeydown={onResponseSearchKey}
                label="Search the response"
                describedby="response-search-status"
                placeholder="Search the response"
              />
              <p id="response-search-status" class="text-fg-muted mt-1 text-xs" aria-live="polite">
                {searchStatus}
              </p>
            </div>
          {/if}
        </div>
      {/if}
    {/snippet}

    {#if ownAccept}
      <p class="text-warning mb-2 text-xs">
        Your own Accept header is sent, so the JSON / XML switch does not change what is asked for.
      </p>
    {/if}
    {#if formatNote}
      <p class="text-fg-muted mb-2 text-xs" role="status">{formatNote}</p>
    {/if}

    {#if loading}
      <div class="bg-surface-2 h-1.5 w-full overflow-hidden rounded">
        <div class="bg-secondary h-full w-1/3 animate-pulse rounded"></div>
      </div>
      <p class="text-fg-muted mt-2 text-sm">Sending&hellip;</p>
    {:else if error}
      <Alert severity="error" title="The request could not be built">
        <p>{error}</p>
      </Alert>
    {:else if !response && cancelled}
      <p class="text-fg-muted text-sm">
        Cancelled before a response arrived. The exchange log records it as cancelled.
      </p>
    {:else if !response}
      <p class="text-fg-muted text-sm">
        No request sent yet. Type a query above, or use a quick query.
      </p>
    {:else}
      <div class="space-y-3">
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
                {#each response.exchange.diagnosis.evidence as e, i (i)}
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

        {#if formatMismatch}
          <Alert severity="warning"><p>{formatMismatch}</p></Alert>
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

        <div bind:this={responseBody}>
          {#if response.json !== undefined}
            {#if viewRaw}
              <pre
                class="bg-bg border-border max-h-[32rem] overflow-auto rounded border p-2 font-mono text-[11px]">{JSON.stringify(
                  response.json,
                  null,
                  2
                )}</pre>
            {:else}
              <!-- Expanded all, the tree is as tall as it needs to be and the page
                 scrolls, rather than a box inside it. -->
              <div
                data-testid="response-tree"
                class="bg-bg border-border overflow-auto rounded border p-2 {expandedAll
                  ? ''
                  : 'max-h-[32rem]'}"
              >
                <!-- Keyed so a node opened or closed by hand follows the new setting. -->
                {#key [treeDepth, treeSearch]}
                  <JsonTree value={response.json} depth={treeDepth} search={treeSearch} />
                {/key}
              </div>
            {/if}
          {:else if response.xml}
            {#if response.xml.problem}
              <p class="text-warning mb-1 text-xs">{response.xml.problem}</p>
            {/if}
            {#if response.xml.tree && !viewRaw}
              <div
                data-testid="response-xml-tree"
                class="bg-bg border-border overflow-auto rounded border p-2 {expandedAll
                  ? ''
                  : 'max-h-[32rem]'}"
              >
                {#key [treeDepth, treeSearch]}
                  <XmlTree node={response.xml.tree} depth={treeDepth} search={treeSearch} />
                {/key}
              </div>
            {:else}
              <!-- Raw is the indented text, as JSON's Raw is; the body exactly
                   as it came is in the exchange log. -->
              <pre
                data-testid="response-xml"
                class="bg-bg border-border max-h-[32rem] overflow-auto rounded border p-2 font-mono text-[11px] break-words whitespace-pre-wrap">{response
                  .xml.pretty ?? response.text}</pre>
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
      </div>
    {/if}
  </Card>
</div>
