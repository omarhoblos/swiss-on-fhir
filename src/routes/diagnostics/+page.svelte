<script lang="ts">
  import { config } from '$lib/config/config.svelte';
  import { diagnostics } from '$lib/diagnostics/diagnostics.svelte';
  import type { CheckGroup } from '$lib/diagnostics/types';
  import {
    countByStatus,
    filterLabel,
    matchesFilter,
    type StatusFilter
  } from '$lib/diagnostics/filter';
  import CheckRow from '$lib/components/CheckRow.svelte';
  import UrlLink from '$lib/components/UrlLink.svelte';
  import CheckStatusFilter from '$lib/components/CheckStatusFilter.svelte';
  import Alert from '$lib/components/ui/Alert.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import { downloadText, timestampedFilename } from '$lib/download';

  const GROUP_LABELS: Record<CheckGroup, { title: string; blurb: string }> = {
    environment: {
      title: 'Environment',
      blurb: 'No network needed. Rules the browser will apply regardless of your server.'
    },
    discovery: {
      title: 'Discovery',
      blurb: 'Can Swiss reach and parse the documents that describe your server?'
    },
    capabilities: {
      title: 'Capabilities',
      blurb: 'Does the server support what Swiss is configured to ask for?'
    },
    cors: {
      title: 'Cross-origin access',
      blurb: 'Can this page actually talk to the endpoints a launch depends on?'
    },
    flow: { title: 'Live flow', blurb: 'Requires an active session.' },
    permissions: { title: 'Permission enforcement', blurb: 'Requires an active session.' }
  };

  /**
   * One filter per group, so narrowing Discovery to failures does not also
   * hide everything that passed under Environment.
   *
   * Not reset between runs: if you have filtered down to failures and hit
   * "Run again", you are almost certainly still looking for failures.
   */
  let filters = $state<Record<CheckGroup, StatusFilter>>({
    environment: 'all',
    discovery: 'all',
    capabilities: 'all',
    cors: 'all',
    flow: 'all',
    permissions: 'all'
  });

  const groups = $derived(
    (Object.keys(GROUP_LABELS) as CheckGroup[])
      .map((group) => {
        const checks = diagnostics.results.filter((r) => r.group === group);
        return {
          group,
          checks,
          counts: countByStatus(checks),
          // The card itself is keyed off `checks`, not this: a group whose
          // every row is filtered out still has to render, or the dropdown
          // that hid them disappears with them and the filter cannot be
          // undone.
          visible: checks.filter((check) => matchesFilter(check.status, filters[group]))
        };
      })
      .filter((g) => g.checks.length > 0)
  );

  function downloadReport() {
    downloadText(
      timestampedFilename('swiss-diagnostics', 'md'),
      diagnostics.exportMarkdown(),
      'text/markdown'
    );
  }
</script>

<div class="space-y-6">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-semibold">Diagnostics</h1>
      <p class="text-fg-muted mt-1 text-sm">
        Checks your configuration against the server, in order, and shows the raw traffic for each
        result. Needs no login &mdash; most problems are visible before a launch is attempted.
      </p>
    </div>
    <div class="flex shrink-0 gap-2">
      {#if diagnostics.running}
        <button
          type="button"
          class="border-border text-fg-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm"
          onclick={() => diagnostics.abort()}
        >
          Stop
        </button>
      {:else}
        <button
          type="button"
          class="bg-primary rounded-md px-3 py-1.5 text-sm font-medium text-white"
          onclick={() => diagnostics.run()}
        >
          {diagnostics.hasRun ? 'Run again' : 'Run checks'}
        </button>
      {/if}
      {#if diagnostics.results.length > 0}
        <button
          type="button"
          class="border-border text-fg-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm"
          onclick={downloadReport}
        >
          Download report
        </button>
      {/if}
    </div>
  </header>

  {#if config.loadError}
    <Alert severity="warning" title="Running against built-in defaults">
      <p>
        The runtime configuration file could not be loaded, so these checks are testing the default
        localhost settings rather than your deployment&rsquo;s.
      </p>
    </Alert>
  {/if}

  {#each config.errors as issue (issue.message)}
    <Alert severity="error">{issue.message}</Alert>
  {/each}

  {#if diagnostics.stale}
    <Alert severity="info" title="Configuration changed since this run">
      <p>
        These results were produced with different settings. Re-run to see the current
        configuration.
      </p>
    </Alert>
  {/if}

  {#if diagnostics.results.length === 0 && !diagnostics.running}
    <Card>
      <p class="text-fg-muted text-sm">
        Nothing has been run yet. Swiss will probe
        <code class="font-mono text-xs">{config.current.fhirBaseUrl || '(no FHIR base set)'}</code>
        and
        <code class="font-mono text-xs">{config.current.authIssuer || '(no issuer set)'}</code>.
      </p>
      <p class="text-fg-muted mt-2 text-xs">
        Every request is deliberate and read-only. One probe intentionally sends an invalid
        authorization code to the token endpoint, which will appear as a <code class="font-mono"
          >400</code
        > in your server logs &mdash; that is expected, and it is how Swiss distinguishes a CORS problem
        from a client-registration problem.
      </p>
    </Card>
  {/if}

  {#if diagnostics.results.length > 0}
    {@const s = diagnostics.summary}
    <Card title="Summary">
      <div class="flex flex-wrap gap-4 text-sm">
        <span class="text-success">{s.pass} passed</span>
        <span class="text-warning">{s.warn} warnings</span>
        <span class="text-error">{s.fail} failed</span>
        <span class="text-fg-muted">{s.skip} skipped</span>
        <span class="text-info">{s.manual} manual</span>
      </div>
      {#if s.manual > 0}
        <p class="text-fg-muted mt-2 text-xs">
          &ldquo;Manual&rdquo; means the check cannot be performed from a browser at all. Those rows
          explain the limitation and what to do instead &mdash; a clean run does not mean everything
          was verified.
        </p>
      {/if}
    </Card>
  {/if}

  {#each groups as { group, checks, counts, visible } (group)}
    <Card title={GROUP_LABELS[group].title} subtitle={GROUP_LABELS[group].blurb}>
      {#snippet actions()}
        <CheckStatusFilter
          label={GROUP_LABELS[group].title}
          value={filters[group]}
          {counts}
          onChange={(next) => (filters[group] = next)}
        />
      {/snippet}
      {#if visible.length === 0}
        <p class="text-fg-muted py-1 text-sm">
          None of the {checks.length} checks in this group are
          <span class="font-medium">{filterLabel(filters[group])}</span>.
          <button
            type="button"
            class="text-primary underline underline-offset-2"
            onclick={() => (filters[group] = 'all')}
          >
            Show all
          </button>
        </p>
      {:else}
        <div class="-mx-4 -my-3">
          {#each visible as check (check.id)}
            <CheckRow {check} />
          {/each}
        </div>
      {/if}
    </Card>
  {/each}

  {#if diagnostics.running}
    <p class="text-fg-muted text-sm">Running checks&hellip;</p>
  {/if}

  {#if Object.keys(diagnostics.endpoints).length > 0}
    <Card title="Resolved endpoints" subtitle="Which document supplied each value.">
      <dl class="space-y-1.5">
        {#each Object.entries(diagnostics.endpoints) as [key, sourced] (key)}
          <div class="flex flex-wrap items-baseline gap-2 text-xs">
            <dt class="text-fg-muted w-56 shrink-0 font-mono">{key}</dt>
            <dd class="font-mono break-all"><UrlLink value={sourced.value} /></dd>
            <span class="text-fg-muted italic">{sourced.source}</span>
          </div>
        {/each}
      </dl>

      {#if diagnostics.conflicts.length > 0}
        <div class="border-border mt-4 border-t pt-3">
          <p class="text-warning text-sm font-medium">
            {diagnostics.conflicts.length} endpoint(s) differ between documents
          </p>
          <p class="text-fg-muted mt-1 mb-2 text-xs">
            Swiss picked the higher-precedence source rather than silently merging. SMART
            configuration outranks OpenID configuration, because the FHIR server is authoritative
            about which authorization server protects it.
          </p>
          <ul class="space-y-2">
            {#each diagnostics.conflicts as conflict (conflict.key)}
              <li class="text-xs">
                <code class="font-mono">{conflict.key}</code>
                <span class={conflict.severity === 'warn' ? 'text-warning' : 'text-fg-muted'}>
                  ({conflict.severity === 'warn' ? 'substantive' : 'cosmetic only'})
                </span>
                <div class="text-fg-muted mt-0.5 pl-3">
                  <div>
                    using <span class="font-mono"><UrlLink value={conflict.chosen.value} /></span>
                    from {conflict.chosen.source}
                  </div>
                  {#each conflict.others as other (other.source)}
                    <div>
                      ignoring <span class="font-mono"><UrlLink value={other.value} /></span>
                      from
                      {other.source}
                    </div>
                  {/each}
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </Card>
  {/if}
</div>
