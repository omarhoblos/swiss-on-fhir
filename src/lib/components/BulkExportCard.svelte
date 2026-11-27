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
  import { onDestroy } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { session } from '#lib/auth/session.svelte.ts';
  import { config } from '#lib/config/config.svelte.ts';
  import { fhirRequest, type FhirMethod, type FhirResponse } from '#lib/fhir/client.ts';
  import { buildFhirUrl } from '#lib/fhir/url.ts';
  import { CORS_HINT } from '#lib/fhir/operation-outcome.ts';
  import {
    EMPTY_KICKOFF,
    KICKOFF_HEADERS,
    NDJSON_ACCEPT,
    STATUS_ACCEPT,
    bulkHeaders,
    checkFile,
    kickoffQuery,
    parseRetryAfter,
    pollDelay,
    previewNdjson,
    readKickoff,
    readPoll,
    type ExportLevel,
    type Finding,
    type KickoffParams,
    type ManifestFile,
    type NdjsonPreview,
    type PollResult
  } from '#lib/fhir/bulk-export.ts';
  import {
    bulkJobsKey,
    parseBulkJobs,
    recordBulkCall,
    removeBulkJob,
    type BulkCallRecord,
    type BulkJob
  } from '#lib/fhir/bulk-jobs.ts';
  import BulkJobsDialog from './BulkJobsDialog.svelte';
  import Alert from './ui/Alert.svelte';
  import Card from './ui/Card.svelte';
  import CopyButton from './ui/CopyButton.svelte';
  import JsonTree from './JsonTree.svelte';
  import Markdown from './Markdown.svelte';

  /**
   * The Bulk Data export flow, one step per button: kick off a `$export`,
   * read the status URL out of `Content-Location`, poll it, and look at the
   * files the manifest lists. Every request goes through the FHIR client, so
   * it is logged and the token follows the console's rule. The card belongs
   * to one environment: the page re-creates it when the environment changes,
   * which stops its requests and its polling.
   */
  let {
    base,
    headers,
    authorize,
    responseTarget
  }: {
    /** The FHIR base requests resolve against, and the token's origin. */
    base: string;
    /** The console's own headers, sent with each request. */
    headers: Record<string, string>;
    /** The console's "Attach the bearer token". */
    authorize: boolean;
    /**
     * Where a refused or unanswered request is shown: the page's Response
     * card. Called before the request is sent; the function it returns takes
     * the response.
     */
    responseTarget?: () => (result: FhirResponse, method: FhirMethod) => void;
  } = $props();

  const LEVELS: { value: ExportLevel; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'patient', label: 'Patient' },
    { value: 'group', label: 'Group' }
  ];

  let params = $state<KickoffParams>({ ...EMPTY_KICKOFF });
  const query = $derived(kickoffQuery(params));
  const kickoffUrl = $derived.by(() => {
    if (!query || !base) return null;
    try {
      return buildFhirUrl(base, query).toString();
    } catch {
      return null;
    }
  });

  type Step = 'kickoff' | 'poll' | 'cancel';
  let busy = $state<Step | null>(null);
  let controller: AbortController | null = null;
  let error = $state<string | null>(null);

  let kickoff = $state<{
    response: FhirResponse;
    findings: Finding[];
    /** Refused, and shown in the Response card instead. */
    inResponse: boolean;
  } | null>(null);
  let statusUrl = $state('');
  /** The base the job was started on, which polls and files keep as the token's origin. */
  let jobBase = $state('');
  let poll = $state<{
    response: FhirResponse;
    result: PollResult | null;
    inResponse: boolean;
  } | null>(null);
  let polls = $state(0);
  let cancelled = $state<{ response: FhirResponse; inResponse: boolean } | null>(null);

  let autoPoll = $state(true);
  let nextPollAt = $state<number | null>(null);
  let now = $state(Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The status URLs this tab has seen on this environment, kept in
   * sessionStorage so a reload does not lose an export still running. The
   * card is re-created when the environment changes, so this is read once.
   */
  const jobsKey = bulkJobsKey(config.activeEnvironmentId);
  let jobs = $state<BulkJob[]>(readJobs());
  let jobsOpen = $state(false);

  function readJobs(): BulkJob[] {
    try {
      return parseBulkJobs(sessionStorage.getItem(jobsKey));
    } catch {
      return [];
    }
  }

  function saveJobs(next: BulkJob[]) {
    jobs = next;
    try {
      if (next.length === 0) sessionStorage.removeItem(jobsKey);
      else sessionStorage.setItem(jobsKey, JSON.stringify(next));
    } catch {
      /* full or unavailable: kept for this page view */
    }
  }

  function remember(record: Omit<BulkCallRecord, 'at'>) {
    saveJobs(recordBulkCall(jobs, { ...record, at: Date.now() }));
  }

  /** Picks up a known export where it was left: its URL, and the base its token goes to. */
  function useJob(job: BulkJob) {
    stop();
    abortPreviews();
    kickoff = null;
    poll = null;
    polls = 0;
    cancelled = null;
    error = null;
    statusUrl = job.statusUrl;
    jobBase = job.base || base;
  }

  /** Lets the token and credential headers go to other origins too, as the console's opt-in does. */
  let allowCrossOrigin = $state(false);

  interface FilePreview {
    loading: boolean;
    response?: FhirResponse;
    preview?: NdjsonPreview;
    findings: Finding[];
    error?: string;
  }
  const previews = new SvelteMap<string, FilePreview>();
  /** Stops every file read at once: a new export, or leaving the card. */
  let previewsController = new AbortController();

  const manifest = $derived(poll?.result?.manifest ?? null);
  const tokenBase = $derived(jobBase || base);

  /** Origins something was held back from in this export, for the opt-in. */
  const withheldFrom = $derived.by(() => {
    const responses = [
      kickoff?.response,
      poll?.response,
      cancelled?.response,
      ...[...previews.values()].map((p) => p.response)
    ];
    const origins = responses.flatMap((r) => [r?.tokenWithheld, r?.credentialsWithheld?.origin]);
    return origins.filter(
      (origin, i): origin is string => origin !== undefined && origins.indexOf(origin) === i
    );
  });

  /**
   * The server refused the request or did not answer. A 429 while polling is
   * the server pacing the client, not a refusal, so it stays in the card.
   */
  function refused(response: FhirResponse, pacing = false): boolean {
    if (response.status === null) return true;
    return response.status >= 400 && !(pacing && response.status === 429);
  }

  function request(
    method: FhirMethod,
    target: string,
    set: Record<string, string>,
    signal: AbortSignal,
    withToken = true
  ): Promise<FhirResponse> {
    return fhirRequest({
      method,
      query: target,
      base,
      tokenBase,
      headers: bulkHeaders($state.snapshot(headers), set),
      accessToken: session.accessToken,
      authorize: authorize && withToken,
      allowCrossOriginToken: allowCrossOrigin,
      signal
    });
  }

  function begin(step: Step): AbortController {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    busy = step;
    error = null;
    return mine;
  }

  function end(mine: AbortController) {
    if (controller !== mine) return;
    controller = null;
    busy = null;
  }

  function fail(cause: unknown) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
    nextPollAt = null;
  }

  function schedule(delay: number) {
    clearTimer();
    nextPollAt = Date.now() + delay;
    timer = setTimeout(() => void pollNow(), delay);
  }

  /** The last answer asks to be polled again. */
  const keepPolling = $derived(
    poll?.result?.state === 'in-progress' || poll?.result?.state === 'too-many-requests'
  );

  function setAutoPoll(on: boolean) {
    autoPoll = on;
    if (!on) clearTimer();
    else if (keepPolling && busy === null) schedule(pollDelay(poll?.result?.retryAfterMs ?? null));
  }

  async function start() {
    if (!query) return;
    clearTimer();
    abortPreviews();
    kickoff = null;
    poll = null;
    polls = 0;
    cancelled = null;
    statusUrl = '';
    jobBase = base;
    const mine = begin('kickoff');
    const toResponse = responseTarget?.();
    try {
      const response = await request('GET', query, KICKOFF_HEADERS, mine.signal);
      if (mine.signal.aborted) return;
      // Refused or unanswered: the Response card shows the OperationOutcome,
      // the 401/403 hints and the network diagnosis, as for any request.
      if (refused(response) && toResponse) {
        toResponse(response, 'GET');
        kickoff = { response, findings: [], inResponse: true };
        return;
      }
      const result = readKickoff(response.exchange);
      kickoff = { response, findings: result.findings, inResponse: false };
      if (result.statusUrl) {
        statusUrl = result.statusUrl;
        remember({
          kind: 'kickoff',
          statusUrl: result.statusUrl,
          base: jobBase,
          kickoffUrl: response.exchange.request.url,
          status: response.status,
          state: 'started'
        });
        const retryAfter = response.exchange.response?.headers?.['retry-after'] ?? null;
        if (autoPoll) schedule(pollDelay(parseRetryAfter(retryAfter)));
      }
    } catch (cause) {
      if (!mine.signal.aborted) fail(cause);
    } finally {
      end(mine);
    }
  }

  async function pollNow() {
    const target = statusUrl.trim();
    if (!target) return;
    clearTimer();
    const mine = begin('poll');
    const toResponse = responseTarget?.();
    try {
      const response = await request('GET', target, { Accept: STATUS_ACCEPT }, mine.signal);
      if (mine.signal.aborted) return;
      polls += 1;
      const result = readPoll(response.exchange, response.json);
      remember({
        kind: 'poll',
        statusUrl: target,
        base: tokenBase,
        status: response.status,
        state: result?.state ?? 'no-answer'
      });
      const inResponse = refused(response, true) && toResponse !== undefined;
      if (inResponse) toResponse?.(response, 'GET');
      poll = { response, result, inResponse };
      if (autoPoll && (result?.state === 'in-progress' || result?.state === 'too-many-requests')) {
        schedule(pollDelay(result.retryAfterMs));
      }
    } catch (cause) {
      if (!mine.signal.aborted) fail(cause);
    } finally {
      end(mine);
    }
  }

  /** DELETE on the status URL, which is how a client cancels an export. */
  async function cancelExport() {
    const target = statusUrl.trim();
    if (!target) return;
    clearTimer();
    const mine = begin('cancel');
    const toResponse = responseTarget?.();
    try {
      const response = await request('DELETE', target, { Accept: STATUS_ACCEPT }, mine.signal);
      if (mine.signal.aborted) return;
      remember({
        kind: 'cancel',
        statusUrl: target,
        base: tokenBase,
        status: response.status,
        state:
          response.status === null ? 'no-answer' : response.status < 400 ? 'cancelled' : 'refused'
      });
      const inResponse = refused(response) && toResponse !== undefined;
      if (inResponse) toResponse?.(response, 'DELETE');
      cancelled = { response, inResponse };
    } catch (cause) {
      if (!mine.signal.aborted) fail(cause);
    } finally {
      end(mine);
    }
  }

  function stop() {
    controller?.abort();
    clearTimer();
  }

  /**
   * Reads one file. The token goes with it only when the manifest says the
   * files need it: they are often on storage that is not the FHIR server.
   */
  async function previewFile(file: ManifestFile) {
    const url = file.url;
    if (!url) return;
    const mine = previewsController;
    previews.set(url, { loading: true, findings: [] });
    try {
      const response = await request(
        'GET',
        url,
        { Accept: NDJSON_ACCEPT },
        mine.signal,
        manifest?.requiresAccessToken !== false
      );
      if (mine.signal.aborted) return;
      if (!response.ok || response.text === undefined) {
        previews.set(url, { loading: false, response, findings: [] });
        return;
      }
      const preview = previewNdjson(response.text);
      const contentType = response.exchange.response?.headers?.['content-type'] ?? null;
      previews.set(url, {
        loading: false,
        response,
        preview,
        findings: checkFile(file, preview, contentType)
      });
    } catch (cause) {
      if (mine.signal.aborted) return;
      previews.set(url, {
        loading: false,
        findings: [],
        error: cause instanceof Error ? cause.message : String(cause)
      });
    }
  }

  function abortPreviews() {
    previewsController.abort();
    previewsController = new AbortController();
    previews.clear();
  }

  // The countdown to the next poll.
  $effect(() => {
    if (nextPollAt === null) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });
  const secondsToPoll = $derived(
    nextPollAt === null ? null : Math.max(0, Math.ceil((nextPollAt - now) / 1000))
  );

  onDestroy(() => {
    controller?.abort();
    clearTimer();
    previewsController.abort();
  });

  const BUSY_LABEL: Record<Step, string> = {
    kickoff: 'Starting the export',
    poll: 'Polling the status URL',
    cancel: 'Cancelling the export'
  };

  const STATE_LABEL: Record<PollResult['state'], string> = {
    'in-progress': 'In progress',
    complete: 'Complete',
    failed: 'Failed',
    'too-many-requests': 'Polling too often',
    unexpected: 'Unexpected answer'
  };

  function plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
  }
</script>

{#snippet problems(response: FhirResponse, findings: Finding[])}
  {#if response.exchange.outcome === 'network-or-cors' || response.exchange.outcome === 'blocked-precondition' || response.exchange.outcome === 'timeout'}
    <Alert severity="error" title="The request did not complete">
      {#if response.exchange.diagnosis}
        <ul class="mt-1 list-inside list-disc space-y-0.5">
          {#each response.exchange.diagnosis.evidence as e, i (i)}
            <li>{e}</li>
          {/each}
        </ul>
      {/if}
      <p class="mt-2">{CORS_HINT}</p>
    </Alert>
  {/if}
  {#each findings as finding, i (i)}
    <Alert severity={finding.severity}><p><Markdown text={finding.text} inline /></p></Alert>
  {/each}
  {#each response.issues as issue, i (i)}
    <Alert severity={issue.severity === 'warning' ? 'warning' : 'error'}>
      <p>
        <span class="font-mono text-xs">{issue.severity}/{issue.code}</span>
        {#if issue.diagnostics || issue.details}&mdash; {issue.diagnostics ?? issue.details}{/if}
      </p>
    </Alert>
  {/each}
{/snippet}

{#snippet files(title: string, list: ManifestFile[], field: string)}
  {#if list.length > 0}
    <div>
      <p class="text-sm font-medium">{title}</p>
      <ul class="mt-1 space-y-2" data-testid="bulk-{field}">
        {#each list as file, i (i)}
          {@const shown = file.url ? previews.get(file.url) : undefined}
          <li class="border-border rounded-md border px-3 py-2 text-xs">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="font-medium">{file.type ?? '(no type)'}</span>
              {#if file.count !== null}
                <span class="text-fg-muted">{plural(file.count, 'resource')}</span>
              {/if}
              {#if file.url}
                <span class="ml-auto flex gap-2">
                  <CopyButton value={file.url} label="Copy URL" />
                  <button
                    type="button"
                    class="border-border-control text-fg-muted hover:text-fg rounded border px-2 py-1 disabled:opacity-50"
                    disabled={shown?.loading}
                    onclick={() => void previewFile(file)}
                  >
                    {shown ? 'Read again' : 'Read file'}
                  </button>
                </span>
              {/if}
            </div>
            <p class="text-fg-muted mt-1 font-mono break-all">{file.url ?? '(no usable URL)'}</p>
            {#if shown?.loading}
              <p class="text-fg-muted mt-1">Reading&hellip;</p>
            {:else if shown?.error}
              <p class="text-error mt-1">{shown.error}</p>
            {:else if shown?.response}
              <div class="mt-2 space-y-1">
                {#if !shown.response.ok}
                  <p class="text-error">
                    The file could not be read; its response is in the exchange log.
                  </p>
                {/if}
                {#if shown.response.tokenWithheld === undefined && manifest?.requiresAccessToken === false}
                  <p class="text-fg-muted">
                    Sent without the token: the manifest says the files do not need it.
                  </p>
                {/if}
                {#if shown.preview}
                  <p data-testid="bulk-file-summary">
                    {plural(shown.preview.lines, 'line')}{#if shown.preview.types.length > 0}:
                      {shown.preview.types.map(([t, n]) => `${n} ${t}`).join(', ')}{/if}
                  </p>
                  {#if shown.preview.head.length > 0}
                    <pre
                      class="bg-bg border-border max-h-40 overflow-auto rounded border p-2 font-mono text-[11px] whitespace-pre-wrap">{shown.preview.head
                        .map((line) => (line.length > 400 ? `${line.slice(0, 400)}…` : line))
                        .join('\n')}</pre>
                  {/if}
                {/if}
                {@render problems(shown.response, shown.findings)}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

<Card
  title="Bulk export"
  subtitle="Start a $export, then follow its status URL to the files."
  busy={busy ? BUSY_LABEL[busy] : undefined}
>
  <div class="space-y-4" data-testid="bulk-export">
    <div class="flex flex-wrap items-end gap-2">
      <label class="text-xs">
        <span class="text-fg-muted block">Level</span>
        <select
          bind:value={params.level}
          class="border-border-control bg-bg mt-0.5 rounded-md border py-1.5 pr-7 pl-2 text-sm"
          aria-label="Export level"
        >
          {#each LEVELS as level (level.value)}
            <option value={level.value}>{level.label}</option>
          {/each}
        </select>
      </label>
      {#if params.level === 'group'}
        <label class="text-xs">
          <span class="text-fg-muted block">Group id</span>
          <input
            type="text"
            bind:value={params.groupId}
            spellcheck="false"
            class="border-border-control bg-bg mt-0.5 w-48 rounded-md border px-2 py-1.5 font-mono text-sm"
          />
        </label>
      {/if}
      {#if busy}
        <button
          type="button"
          class="border-border-control text-fg-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm"
          onclick={stop}
        >
          Stop
        </button>
      {:else}
        <button
          type="button"
          class="bg-primary text-on-primary rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          disabled={!kickoffUrl}
          onclick={() => void start()}
        >
          Start export
        </button>
      {/if}
    </div>

    <details class="text-xs">
      <summary class="text-fg-muted cursor-pointer">Parameters</summary>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">
        {#snippet param(
          name: string,
          key: 'types' | 'since' | 'typeFilter' | 'outputFormat',
          hint: string
        )}
          <label>
            <span class="text-fg-muted block font-mono">{name}</span>
            <input
              type="text"
              bind:value={params[key]}
              placeholder={hint}
              spellcheck="false"
              class="border-border-control bg-bg mt-0.5 w-full rounded-md border px-2 py-1.5 font-mono text-xs"
            />
          </label>
        {/snippet}
        {@render param('_type', 'types', 'Patient,Observation')}
        {@render param('_since', 'since', '2026-01-01T00:00:00Z')}
        {@render param('_typeFilter', 'typeFilter', 'Observation?status=final')}
        {@render param('_outputFormat', 'outputFormat', 'application/fhir+ndjson')}
      </div>
    </details>

    <div class="text-xs">
      <p class="text-fg-muted font-mono break-all" data-testid="bulk-kickoff-url">
        GET {kickoffUrl ?? (params.level === 'group' ? '(enter a group id)' : '(no FHIR base)')}
      </p>
      <p class="text-fg-muted mt-1">
        Sent with <code class="font-mono">Accept: {KICKOFF_HEADERS.Accept}</code> and
        <code class="font-mono">Prefer: {KICKOFF_HEADERS.Prefer}</code>, plus your headers above.
      </p>
    </div>

    {#if error}
      <Alert severity="error" title="The request could not be built"><p>{error}</p></Alert>
    {/if}

    <!-- A refused kick-off is in the Response card. -->
    {#if kickoff && !kickoff.inResponse}
      <div class="space-y-1" data-testid="bulk-kickoff">
        {@render problems(kickoff.response, kickoff.findings)}
      </div>
    {/if}

    <div class="border-border space-y-2 border-t pt-3">
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-sm font-medium" for="bulk-status-url">Status URL</label>
        {#if jobs.length > 0}
          <button
            type="button"
            class="text-primary ml-auto text-xs hover:underline"
            onclick={() => (jobsOpen = true)}
          >
            Known status URLs ({jobs.length})
          </button>
        {/if}
      </div>
      <div class="flex flex-wrap gap-2">
        <input
          id="bulk-status-url"
          type="text"
          bind:value={statusUrl}
          placeholder="From Content-Location, or provide one"
          spellcheck="false"
          class="border-border-control bg-bg min-w-48 flex-1 rounded-md border px-2 py-1.5 font-mono text-xs"
        />
        {#if statusUrl.trim()}
          <CopyButton value={statusUrl.trim()} />
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="bg-primary text-on-primary rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          disabled={!statusUrl.trim() || busy !== null}
          onclick={() => void pollNow()}
        >
          Poll now
        </button>
        <button
          type="button"
          class="border-border-control text-fg-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={!statusUrl.trim() || busy !== null}
          onclick={() => void cancelExport()}
        >
          Cancel export
        </button>
        <label class="text-fg-muted flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={autoPoll}
            onchange={(e) => setAutoPoll(e.currentTarget.checked)}
            class="accent-primary h-3.5 w-3.5"
          />
          Poll based on what <code class="font-mono">Retry-After</code> allows
        </label>
      </div>
      <p class="text-fg-muted text-xs" aria-live="polite" data-testid="bulk-poll-status">
        {#if secondsToPoll !== null}
          Next poll in {secondsToPoll}s.
        {/if}
        {#if polls > 0}
          {plural(polls, 'poll')} so far; each is in the exchange log.
        {/if}
      </p>

      {#if withheldFrom.length > 0}
        <label class="text-warning flex cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            bind:checked={allowCrossOrigin}
            class="accent-primary mt-0.5 h-3.5 w-3.5"
          />
          <span>
            The token and credential headers were not sent to
            <span class="font-medium">{withheldFrom.join(', ')}</span>: not the FHIR base. Tick to
            send them.
          </span>
        </label>
      {/if}

      <!-- A refused cancellation is in the Response card. -->
      {#if cancelled && !cancelled.inResponse}
        <div class="space-y-1" data-testid="bulk-cancel">
          {#if cancelled.response.status === 202}
            <Alert severity="success"><p>The server accepted the cancellation.</p></Alert>
          {:else}
            <Alert severity="warning">
              <p>
                A cancellation is answered with <code>202 Accepted</code>; got {cancelled.response
                  .status}.
              </p>
            </Alert>
            {@render problems(cancelled.response, [])}
          {/if}
        </div>
      {/if}

      {#if poll}
        <div class="space-y-1" data-testid="bulk-poll">
          {#if poll.result}
            <p class="text-sm">
              <span class="font-medium" data-testid="bulk-state"
                >{STATE_LABEL[poll.result.state]}</span
              >
              {#if poll.result.progress}
                <span class="text-fg-muted"> &mdash; {poll.result.progress}</span>
              {/if}
            </p>
          {/if}
          {#if !poll.inResponse}
            {@render problems(poll.response, poll.result?.findings ?? [])}
          {/if}
        </div>
      {/if}
    </div>

    {#if manifest}
      <div class="border-border space-y-3 border-t pt-3" data-testid="bulk-manifest">
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt class="text-fg-muted">transactionTime</dt>
          <dd class="font-mono">{manifest.transactionTime ?? '—'}</dd>
          <dt class="text-fg-muted">requiresAccessToken</dt>
          <dd class="font-mono">{manifest.requiresAccessToken ?? '—'}</dd>
          <dt class="text-fg-muted">Files</dt>
          <dd>
            {plural(manifest.output.length, 'output')}, {plural(manifest.error.length, 'error')}
            {#if manifest.deleted.length > 0}, {manifest.deleted.length} deleted{/if}
          </dd>
        </dl>
        {#if manifest.output.length === 0}
          <p class="text-fg-muted text-xs">The export produced no files.</p>
        {/if}
        {@render files('Output', manifest.output, 'output')}
        {@render files('Errors', manifest.error, 'error')}
        {@render files('Deleted', manifest.deleted, 'deleted')}
        <details class="text-xs">
          <summary class="text-fg-muted cursor-pointer">The manifest as it came</summary>
          <div class="bg-bg border-border mt-1 max-h-80 overflow-auto rounded border p-2">
            <JsonTree value={poll?.response.json} depth={Infinity} />
          </div>
        </details>
      </div>
    {/if}
  </div>
</Card>

<BulkJobsDialog
  bind:open={jobsOpen}
  {jobs}
  onuse={useJob}
  onremove={(url) => saveJobs(removeBulkJob(jobs, url))}
  onclear={() => saveJobs([])}
/>
