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
  import { version } from '$app/environment';
  import { ALL_CHECKS } from '$lib/diagnostics/checks';
  import { GROUP_LABELS } from '$lib/diagnostics/groups';
  import Figure from '$lib/components/how-it-works/Figure.svelte';
  import AppShape from '$lib/components/how-it-works/AppShape.svelte';
  import ConfigLayers from '$lib/components/how-it-works/ConfigLayers.svelte';
  import DiscoveryOrder from '$lib/components/how-it-works/DiscoveryOrder.svelte';
  import SignInSequence from '$lib/components/how-it-works/SignInSequence.svelte';
  import LaunchStates from '$lib/components/how-it-works/LaunchStates.svelte';
  import RequestLog from '$lib/components/how-it-works/RequestLog.svelte';
  import TokenRouting from '$lib/components/how-it-works/TokenRouting.svelte';
  import ReleasePipeline from '$lib/components/how-it-works/ReleasePipeline.svelte';

  /**
   * How Swiss's parts fit together, one diagram per mechanism, for people
   * using Swiss and people changing it. It links nowhere outside the app.
   *
   * Anything that would go stale is read from the code: the version from the
   * build, and the Diagnostics inventory from ALL_CHECKS. The diagrams and
   * prose describe the code by hand, so keep them in step with it (and with
   * docs/architecture.md, which covers the same ground for the repository).
   */
  const sections = [
    { id: 'shape', title: 'The shape of the app' },
    { id: 'config', title: 'Configuration' },
    { id: 'discovery', title: 'Discovery' },
    { id: 'signin', title: 'Signing in' },
    { id: 'transaction', title: "One launch's lifecycle" },
    { id: 'requests', title: 'Every request is logged' },
    { id: 'token', title: 'Where the token goes' },
    { id: 'diagnostics', title: 'Diagnostics' },
    { id: 'shipping', title: 'From tag to live' },
    { id: 'source', title: 'Reading the source' },
    { id: 'changes', title: 'Making changes' }
  ];

  /**
   * The section being read, highlighted in the contents. A section counts as
   * being read while it crosses a band near the top of the viewport, which is
   * where the eye is after a jump or while scrolling down.
   */
  let active = $state<string | null>(null);

  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) active = entry.target.id;
        }
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  });

  // In run order: a group appears where its first check does.
  const checkGroups = [...new Set(ALL_CHECKS.map((check) => check.group))].map((group) => ({
    group,
    ...GROUP_LABELS[group],
    checks: ALL_CHECKS.filter((check) => check.group === group)
  }));
  const manualCount = ALL_CHECKS.filter((check) => check.id.startsWith('manual.')).length;

  const sourceMap = [
    {
      dir: 'routes/',
      owns: 'One folder per page. Pages read stores and call library functions, and hold little logic of their own.',
      start: ['launch/+page.svelte', '+page.svelte (Session)', 'fhir/+page.svelte']
    },
    {
      dir: 'lib/auth/',
      owns: 'The sign-in: orchestration, the in-flight transaction, the established session and where it is stored.',
      start: ['flow.ts', 'transaction.ts', 'session.svelte.ts']
    },
    {
      dir: 'lib/oidc/',
      owns: 'OAuth and OpenID Connect building blocks, each a plain function that takes an optional fetchImpl for tests.',
      start: ['token.ts', 'id-token.ts', 'claims.ts']
    },
    {
      dir: 'lib/smart/',
      owns: 'SMART specifics: discovery and merging, feature gates, launch context, scope parsing and diffs.',
      start: ['discovery.ts', 'scopes.ts', 'context.ts']
    },
    {
      dir: 'lib/config/',
      owns: 'Settings: the field table, parsing, validation, the four layers and where overrides are saved.',
      start: ['fields.ts', 'config.svelte.ts', 'runtime.ts']
    },
    {
      dir: 'lib/diagnostics/',
      owns: 'The checks, the runner that orders and skips them, and the store that also holds discovery results.',
      start: ['checks/discovery.ts', 'runner.ts', 'diagnostics.svelte.ts']
    },
    {
      dir: 'lib/http/',
      owns: 'The one road out: probe(), the exchange record, redaction, the log, its storage and filters.',
      start: ['probe.ts', 'exchange.ts', 'log.svelte.ts']
    },
    {
      dir: 'lib/fhir/',
      owns: "The FHIR console's request layer: URL building, paging, OperationOutcome parsing, server names.",
      start: ['client.ts', 'url.ts', 'operation-outcome.ts']
    },
    {
      dir: 'lib/components/',
      owns: 'Shared UI: token panels, the glossary, the log drawer, check rows, the nav. ui/ holds the small primitives.',
      start: ['TokenPanel.svelte', 'ExchangeLogDrawer.svelte', 'ClaimGlossary.svelte']
    },
    {
      dir: 'e2e/',
      owns: 'Playwright, Chromium and Firefox. fixtures.ts stubs a server and can seed a session, so most specs skip the sign-in.',
      start: ['fixtures.ts', 'flow.spec.ts', 'diagnostics.spec.ts']
    }
  ];
</script>

<svelte:head>
  <title>How Swiss works · Swiss on FHIR</title>
</svelte:head>

{#snippet files(list: string[])}
  <p class="text-fg-muted mt-4 mb-1.5 text-[11px] font-semibold tracking-wider uppercase">
    Read this code
  </p>
  <ul class="flex flex-wrap gap-1.5">
    {#each list as file (file)}
      <li class="border-border bg-surface rounded-full border px-2.5 py-0.5 font-mono text-xs">
        {file}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10">
  <nav aria-label="On this page" class="mb-6 text-sm lg:sticky lg:top-6 lg:mb-0 lg:self-start">
    <p class="text-fg-muted mb-2 text-[11px] font-semibold tracking-wider uppercase">
      On this page
    </p>
    <ol class="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
      {#each sections as section (section.id)}
        <li>
          <a
            href="#{section.id}"
            aria-current={active === section.id ? 'location' : undefined}
            class="block rounded-full border px-2.5 py-0.5 transition-colors lg:rounded-none lg:border-0 lg:border-l-2 lg:px-3 lg:py-1
              {active === section.id
              ? 'border-primary text-primary'
              : 'border-border text-fg-muted hover:text-fg'}"
          >
            {section.title}
          </a>
        </li>
      {/each}
    </ol>
  </nav>

  <article class="hiw min-w-0">
    <header>
      <p class="text-primary font-mono text-xs">Swiss on FHIR {version}</p>
      <h1 class="mt-1 text-2xl font-semibold">How Swiss works</h1>
      <p class="text-fg-muted mt-2 max-w-3xl">
        Swiss is a browser app for testing FHIR servers and the SMART on FHIR authorization servers
        in front of them. It runs the sign-in itself, shows every request and token, and reports
        what a server gets wrong. This page shows how its parts fit together, one mechanism per
        diagram, and ends with where to start reading the code.
      </p>

      <div class="mt-6 grid gap-3 sm:grid-cols-3">
        <div class="border-border bg-surface rounded-lg border p-4">
          <h2 class="text-primary text-base font-semibold">Report, don't refuse</h2>
          <p class="text-fg-muted mt-1 text-sm">
            A wrong nonce, an unverifiable ID token or a mismatched issuer becomes a finding shown
            next to the token. Swiss never blocks the sign-in over it, because that finding is what
            the tool is for.
          </p>
        </div>
        <div class="border-border bg-surface rounded-lg border p-4">
          <h2 class="text-primary text-base font-semibold">Advertise, don't block</h2>
          <p class="text-fg-muted mt-1 text-sm">
            Servers under-report what they support. A capability missing from a discovery document
            only produces a warning; only an explicit contradiction disables a control.
          </p>
        </div>
        <div class="border-border bg-surface rounded-lg border p-4">
          <h2 class="text-primary text-base font-semibold">Show every request</h2>
          <p class="text-fg-muted mt-1 text-sm">
            Swiss builds the authorization URL itself so you can preview it, and every HTTP request
            goes through one function whose record ends up in the exchange log.
          </p>
        </div>
      </div>

      <ul
        class="text-fg-muted mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm"
        aria-label="How to read the diagrams"
      >
        <li class="flex items-center gap-2">
          <span class="swatch border-primary"></span>Swiss's own code and requests
        </li>
        <li class="flex items-center gap-2">
          <span class="swatch border-json-key"></span>Data kept in the browser
        </li>
        <li class="flex items-center gap-2">
          <span class="swatch border-info"></span>Your servers
        </li>
        <li class="flex items-center gap-2">
          <span class="dashed"></span>A browser navigation, not a request Swiss reads
        </li>
      </ul>
    </header>

    <section id="shape">
      <h2>The shape of the app</h2>
      <p>
        There is no Swiss backend. The container serves files once, when the page loads, and from
        then on everything runs in your browser tab. Requests go from the tab straight to your
        servers.
      </p>
      <Figure>
        <AppShape />
        {#snippet caption()}
          <strong>Two hosts, one direction of travel.</strong> The container serves the built app
          and
          <code>/swiss-env.json</code>, which its entrypoint script writes from <code>.env</code> at
          startup; it refuses to start on a control character or an over-long value. In the tab,
          pages read four shared stores, the stores call plain library functions, and every request
          leaves through <code>probe()</code>. The dashed line is the sign-in redirect: the browser
          navigates to the authorization server and back, which Swiss can preview but not read.
        {/snippet}
      </Figure>
      {@render files([
        'routes/+layout.ts',
        'routes/+layout.svelte',
        'docker/docker-entrypoint.d/',
        'docker/nginx.conf'
      ])}
    </section>

    <section id="config">
      <h2>Configuration: four layers, one result</h2>
      <p>
        Every page reads one object, <code>config.current</code>. It is built per field from four
        layers, and a higher layer wins. That is how <code>.env</code>, edits on the Config screen
        and an EHR launch can all change a setting without overwriting each other.
      </p>
      <Figure>
        <ConfigLayers />
        {#snippet caption()}
          <strong>Layers stack per field.</strong> A value typed on the Config screen beats
          <code>.env</code> only for that field, and the screen labels each value with where it came
          from. The launch layer is held in memory only, so one EHR launch cannot rewrite your saved
          settings. The client secret is kept apart: it lives in <code>sessionStorage</code> unless you
          choose "remember", and it is left out of the snapshot of the settings that each launch saves.
        {/snippet}
      </Figure>
      <p>
        Every setting is one row in a table, <code>FIELDS</code> in <code>config/fields.ts</code>,
        which drives parsing the value, validating it and the Config form. Values from
        <code>/swiss-env.json</code> are always strings, so <code>coerce.ts</code> turns them into URLs,
        booleans and enums, and recognises a placeholder that was never filled in.
      </p>
      {@render files([
        'config/config.svelte.ts',
        'config/fields.ts',
        'config/runtime.ts',
        'config/coerce.ts',
        'config/validate.ts',
        'config/persist.ts'
      ])}
    </section>

    <section id="discovery">
      <h2>Discovery: whose word wins</h2>
      <p>
        Before a sign-in, Swiss needs the server's endpoints: where to authorize, where to swap the
        code for tokens, where the signing keys are. Up to three documents can say, and they often
        disagree. Swiss reads them all and decides per endpoint, in a fixed order of trust.
      </p>
      <Figure>
        <DiscoveryOrder />
        {#snippet caption()}
          <strong>The FHIR server outranks the identity provider.</strong> In SMART, the FHIR server
          is the authority on which authorization server protects it, so
          <code>smart-configuration</code> beats <code>openid-configuration</code>. An EHR launch's
          <code>iss</code> is not a source here: it changes the FHIR base through the
          configuration's launch layer, and discovery then runs against that server. Swiss keeps
          every candidate, so when the preferred <code>jwks_uri</code> does not answer, the ID token check
          tries the next one and says so.
        {/snippet}
      </Figure>
      <p>
        Discovery runs when you open the Launch page, and otherwise only when you ask. It never
        re-runs because you edited a setting, since that would hit your servers on every keystroke.
      </p>
      {@render files([
        'smart/discovery.ts',
        'diagnostics/diagnostics.svelte.ts',
        'smart/capabilities.ts'
      ])}
    </section>

    <section id="signin">
      <h2>Signing in: from Launch to Session</h2>
      <p>
        A sign-in is the authorization code flow with PKCE, built and checked by Swiss itself.
        <code>auth/flow.ts</code> holds both halves: <code>beginAuthorization</code> before the
        redirect and <code>completeCallback</code> after it.
      </p>
      <Figure>
        <SignInSequence />
        {#snippet caption()}
          <strong>Everything the callback needs is saved before the redirect.</strong> The transaction
          in step 2 holds the PKCE verifier, the redirect URI and a snapshot of the endpoints and settings,
          so editing the configuration mid-flow cannot break the exchange. In step 7 a failed check becomes
          a warning on the callback page and a note on the ID token panel; the session is established
          either way. The callback page strips the code from the URL before doing anything else, so a
          reload cannot re-send it.
        {/snippet}
      </Figure>
      <p>
        After sign-in, <code>smart/context.ts</code> works out the launch context:
        <code>patient</code> and <code>encounter</code> from the token response first, then the ID
        token, then the access token; <code>fhirUser</code> from the ID token first.
        <code>smart/scopes.ts</code>
        compares what you asked for with what was granted, in SMART 1.0 and 2.0 syntax. Refresh is manual
        on purpose, and a refreshed ID token is checked again, including that its subject has not changed.
      </p>
      {@render files([
        'auth/flow.ts',
        'oidc/pkce.ts',
        'oidc/authorize.ts',
        'oidc/token.ts',
        'oidc/id-token.ts',
        'oidc/iss-parameter.ts',
        'auth/session.svelte.ts',
        'e2e/flow.spec.ts'
      ])}
    </section>

    <section id="transaction">
      <h2>One launch's lifecycle</h2>
      <p>
        Each launch is saved in <code>sessionStorage</code> under
        <code>swiss.tx.v1.&lt;state&gt;</code>
        and moves through four states. They exist to stop one mistake: sending a single-use authorization
        code twice and getting a confusing <code>invalid_grant</code>.
      </p>
      <Figure>
        <LaunchStates />
        {#snippet caption()}
          <strong>A state that matches nothing is not trusted.</strong> An <code>?error=</code>
          whose
          <code>state</code> matches no launch in this tab is still shown, labelled as not from your launch,
          and nothing is recorded against your session. Old transactions are pruned when the app loads.
        {/snippet}
      </Figure>
      {@render files(['auth/transaction.ts', 'routes/callback/+page.svelte'])}
    </section>

    <section id="requests">
      <h2>Every request is logged</h2>
      <p>
        Discovery, token requests, Diagnostics probes and the FHIR console all send their requests
        through <code>probe()</code>. It records what happened and sorts the outcome into a cause
        you can act on; the caller then adds that record to the exchange log at the bottom of every
        page.
      </p>
      <Figure>
        <RequestLog />
        {#snippet caption()}
          <strong>Only the redacted form ever reaches disk.</strong> Exchanges carry live tokens. The
          copy saved to IndexedDB, which is what lets the log survive the sign-in redirect and a reload,
          has secrets and tokens masked whatever the redaction setting says. A failed request also carries
          a diagnosis: the likely cause, how confident Swiss is, and the evidence, such as a CORS block
          or a page that is not a secure context.
        {/snippet}
      </Figure>
      {@render files([
        'http/probe.ts',
        'http/exchange.ts',
        'http/log.svelte.ts',
        'http/log-persist.ts',
        'http/log-filter.ts',
        'components/ExchangeLogDrawer.svelte'
      ])}
    </section>

    <section id="token">
      <h2>Where the token goes</h2>
      <p>
        The FHIR console attaches your access token only to the server it was issued for. It follows
        the session, not the settings: changing the FHIR base on the Config screen, or an EHR launch
        passing a different <code>iss</code>, does not move the token to a new server.
      </p>
      <Figure>
        <TokenRouting />
        {#snippet caption()}
          <strong>Typed URLs and paging links are checked too.</strong> An absolute URL typed into
          the console, or a <code>Bundle.link[next]</code> that points at another host, gets the token
          only after you allow it for the current page, and the console says when it was withheld. Writes
          (POST, PUT, PATCH, DELETE) also need an explicit switch per server.
        {/snippet}
      </Figure>
      {@render files(['fhir/client.ts', 'fhir/url.ts', 'routes/fhir/+page.svelte'])}
    </section>

    <section id="diagnostics">
      <h2>Diagnostics</h2>
      <p>
        Diagnostics runs {ALL_CHECKS.length} checks in a fixed order, so the report reads as a story:
        what the browser allows, whether the documents load, whether the server supports what you are
        about to ask for, whether this page can reach it. A check that depends on another is skipped,
        by name, when that one fails. {manualCount} of them cannot be checked from a browser at all, and
        explain what to check instead. Each result carries the raw requests behind it, so you can verify
        any finding yourself.
      </p>

      <div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="check-inventory">
        {#each checkGroups as group (group.group)}
          <div
            class="border-border bg-surface hover:border-primary hover:bg-surface-2 min-w-0 rounded-lg border p-3 motion-safe:transition-colors"
          >
            <h3 class="flex items-baseline justify-between gap-2 text-sm font-semibold">
              {group.title}
              <span class="text-fg-muted font-mono text-xs font-normal">{group.checks.length}</span>
            </h3>
            <p class="text-fg-muted mt-0.5 mb-2 text-xs">{group.blurb}</p>
            <ul class="space-y-1.5">
              {#each group.checks as check (check.id)}
                <li class="text-xs">
                  <span class="block">{check.title}</span>
                  <span class="text-fg-muted block font-mono text-[11px] break-all">
                    {check.id}{#if check.dependsOn?.length}&nbsp;· needs {check.dependsOn.join(
                        ', '
                      )}{/if}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
      <p class="text-fg-muted mt-4 text-sm">
        One probe deliberately sends a fake authorization code to the token endpoint. The answer
        tells a CORS problem (no readable response) from a client registration problem (<code
          >invalid_client</code
        >) from a healthy setup (<code>invalid_grant</code>).
      </p>
      {@render files([
        'diagnostics/checks/*.ts',
        'diagnostics/runner.ts',
        'diagnostics/types.ts',
        'diagnostics/remediation.ts'
      ])}
    </section>

    <section id="shipping">
      <h2>From tag to live</h2>
      <p>
        A release is a version tag. Nothing is published until the full CI suite has passed on the
        tagged commit, and the hosted copy updates itself afterwards.
      </p>
      <Figure>
        <ReleasePipeline />
        {#snippet caption()}
          <strong>One tag, four image tags.</strong> A tag such as <code>v3.2.0</code> publishes
          <code>3.2.0</code>, <code>3.2</code>, <code>3</code> and <code>latest</code>, for amd64
          and arm64. The deploy job asks DigitalOcean App Platform to redeploy the hosted app, which
          follows
          <code>3</code>, then checks that the live site serves a rendered
          <code>/swiss-env.json</code>. Pre-release tags such as <code>v3.2.0-rc.1</code> publish only
          their own tag and do not deploy.
        {/snippet}
      </Figure>
      {@render files([
        '.github/workflows/release.yml',
        '.github/workflows/ci.yml',
        'Dockerfile',
        '.do/app.yaml'
      ])}
    </section>

    <section id="source">
      <h2>Reading the source</h2>
      <p>
        Everything lives under <code>src/</code>: a SvelteKit app built to static files, with
        <code>jose</code> as its only runtime dependency. Shared state is held in Svelte 5 rune
        classes exported as single instances, not in <code>svelte/store</code>. Unit tests sit
        beside the code as
        <code>*.test.ts</code>. The repository's <code>docs/</code> folder has a longer developer guide.
      </p>
      <div class="border-border mt-4 overflow-x-auto rounded-lg border">
        <table class="w-full min-w-[640px] text-sm">
          <thead class="bg-surface text-fg-muted text-left text-[11px] tracking-wider uppercase">
            <tr>
              <th class="px-3 py-2 font-semibold">Directory</th>
              <th class="px-3 py-2 font-semibold">What it owns</th>
              <th class="px-3 py-2 font-semibold">Start with</th>
            </tr>
          </thead>
          <tbody>
            {#each sourceMap as row (row.dir)}
              <tr class="border-border border-t align-top">
                <td class="text-primary px-3 py-2 font-mono text-xs whitespace-nowrap">{row.dir}</td
                >
                <td class="px-3 py-2">{row.owns}</td>
                <td class="px-3 py-2 font-mono text-xs">
                  {#each row.start as file (file)}<span class="block">{file}</span>{/each}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section id="changes">
      <h2>Making changes</h2>
      <p>
        <code>npm run dev</code> serves on port 4200, which is fixed because existing client
        registrations use <code>http://localhost:4200/callback</code>. <code>npm run check</code>,
        <code>npm run lint</code>, <code>npm run test:unit</code> and <code>npm run test:e2e</code> are
        what CI runs.
      </p>

      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <div class="border-border bg-surface rounded-lg border p-4">
          <h3 class="text-sm font-semibold">Add a diagnostic check</h3>
          <ol class="steps">
            <li>
              Write a <code>Check</code> in the group's file under <code>diagnostics/checks/</code>
              and return a <code>result()</code>.
            </li>
            <li>
              Append it to that group's array; set <code>dependsOn</code> if it needs another check's
              success.
            </li>
            <li>
              Make requests through <code>probe()</code> with <code>ctx.fetchImpl</code>, and return
              the exchanges with the result.
            </li>
            <li>Unit test it with a hand-built context. It appears on this page by itself.</li>
          </ol>
        </div>
        <div class="border-border bg-surface rounded-lg border p-4">
          <h3 class="text-sm font-semibold">Add a setting</h3>
          <ol class="steps">
            <li>
              Add the key to <code>AppConfig</code> in <code>config/types.ts</code> and a default in
              <code>config/defaults.ts</code>.
            </li>
            <li>
              Add one row to <code>FIELDS</code> in <code>config/fields.ts</code>; the Config screen
              picks it up.
            </li>
            <li>
              If it comes from <code>.env</code>, set <code>envKey</code> and add it to
              <code>config/env.template.json</code>
              and to <code>40-swiss-config.sh</code>, which builds the container's file itself.
            </li>
          </ol>
        </div>
        <div class="border-border bg-surface rounded-lg border p-4">
          <h3 class="text-sm font-semibold">Explain a claim or header parameter</h3>
          <ol class="steps">
            <li>
              Add a definition to <code>DEFINITIONS</code> or <code>HEADER_DEFINITIONS</code> in
              <code>oidc/claims.ts</code>.
            </li>
            <li>Give it a one-sentence summary and the specification section it comes from.</li>
          </ol>
        </div>
        <div class="border-border bg-surface rounded-lg border p-4">
          <h3 class="text-sm font-semibold">Test a sign-in scenario</h3>
          <ol class="steps">
            <li>
              Add a case to <code>e2e/flow.spec.ts</code>, whose stub server checks PKCE and signs
              real ID tokens.
            </li>
            <li>
              Set the stub's options (a wrong nonce, a missing <code>iss</code>, another key) to
              produce the behaviour.
            </li>
            <li>Assert on what Swiss shows, and that the session still exists.</li>
          </ol>
        </div>
      </div>

      <h3 class="mt-6 text-base font-semibold">Rules the code relies on</h3>
      <ul class="rules">
        <li>
          Send every request through <code>probe()</code> and record what it returns. A bare
          <code>fetch</code> is invisible in the exchange log and gets no diagnosis.
        </li>
        <li>
          Do not re-run discovery from an <code>$effect</code> on settings; that sends requests on every
          keystroke.
        </li>
        <li>
          Decide where the token goes from the session's <code>configSnapshot.fhirBaseUrl</code>,
          never from <code>config.current.fhirBaseUrl</code>.
        </li>
        <li>
          Pass any URL that came from a server or a link through <code>httpUrl()</code> before navigating
          to it or linking to it.
        </li>
        <li>
          Treat storage and server text as untrusted: validate what is read back, and build objects
          from outside keys with a <code>Map</code> or <code>Object.fromEntries</code>.
        </li>
        <li>
          New checks report; they do not block. Only a bad deployment input stops the container,
          because that is an operator error, not a server under test.
        </li>
      </ul>
    </section>
  </article>
</div>

<style>
  .hiw section {
    margin-top: 2.75rem;
    padding-top: 2.75rem;
    border-top: 1px solid var(--color-border);
    scroll-margin-top: 1rem;
  }
  .hiw section > h2 {
    margin-bottom: 0.5rem;
    font-size: 1.25rem;
    font-weight: 600;
    text-wrap: balance;
  }
  .hiw section > p {
    max-width: 48rem;
    margin-top: 0.75rem;
  }
  .hiw code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--color-surface-2);
    border-radius: 0.25rem;
    padding: 0.05rem 0.3rem;
    overflow-wrap: anywhere;
  }
  .swatch {
    display: inline-block;
    width: 0.9rem;
    height: 0.65rem;
    border-width: 1.5px;
    border-radius: 2px;
  }
  .dashed {
    display: inline-block;
    width: 1.4rem;
    border-top: 2px dashed var(--color-fg-muted);
  }
  .steps {
    margin-top: 0.5rem;
    padding-left: 1.25rem;
    list-style: decimal;
    font-size: 0.875rem;
    display: grid;
    gap: 0.35rem;
  }
  .steps li::marker {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }
  .rules {
    margin-top: 0.75rem;
    display: grid;
    gap: 0.5rem;
    max-width: 48rem;
    font-size: 0.875rem;
  }
  .rules li {
    position: relative;
    padding-left: 1.25rem;
  }
  .rules li::before {
    content: '';
    position: absolute;
    left: 0.2rem;
    top: 0.55em;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 2px;
    background: var(--color-primary);
  }
</style>
