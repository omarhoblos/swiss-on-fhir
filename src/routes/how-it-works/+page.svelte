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
  import { version } from '$app/env';
  import { ALL_CHECKS } from '#lib/diagnostics/checks/index.ts';
  import { GROUP_LABELS } from '#lib/diagnostics/groups.ts';
  import { findText, paintHighlight, SEARCH_HIGHLIGHT } from '#lib/highlight.ts';
  import Figure from '#lib/components/how-it-works/Figure.svelte';
  import { repoPath, sourceUrl } from '#lib/components/how-it-works/source-link.ts';
  import SearchInput from '#lib/components/ui/SearchInput.svelte';
  import AppShape from '#lib/components/how-it-works/AppShape.svelte';
  import StoreImports from '#lib/components/how-it-works/StoreImports.svelte';
  import ConfigLayers from '#lib/components/how-it-works/ConfigLayers.svelte';
  import DiscoveryOrder from '#lib/components/how-it-works/DiscoveryOrder.svelte';
  import SignInSequence from '#lib/components/how-it-works/SignInSequence.svelte';
  import LaunchStates from '#lib/components/how-it-works/LaunchStates.svelte';
  import RequestLog from '#lib/components/how-it-works/RequestLog.svelte';
  import TokenRouting from '#lib/components/how-it-works/TokenRouting.svelte';
  import ReleasePipeline from '#lib/components/how-it-works/ReleasePipeline.svelte';
  import DiagnosticsOrder from '#lib/components/how-it-works/DiagnosticsOrder.svelte';
  import TabScope from '#lib/components/how-it-works/TabScope.svelte';

  /**
   * Swiss's developer documentation: how its parts fit together, one diagram
   * per mechanism, then how to set up, test, change and release it. It is
   * the only copy of this material, and it links nowhere outside the app
   * except the Related files pills, which open their source on main.
   *
   * Anything that would go stale is read from the code: the version from the
   * build, and the Diagnostics inventory from ALL_CHECKS. The diagrams and
   * prose describe the code by hand, so keep them in step with it. Keep it
   * server-agnostic: no product names, and no private test infrastructure.
   */
  const parts = [
    {
      title: 'How it works',
      sections: [
        { id: 'shape', title: 'The Swiss layout' },
        { id: 'imports', title: 'The component structure' },
        { id: 'config', title: 'Configuration' },
        { id: 'discovery', title: 'Discovery' },
        { id: 'signin', title: 'Signing in' },
        { id: 'transaction', title: 'A launch lifecycle' },
        { id: 'session', title: 'After sign-in' },
        { id: 'tabs', title: 'Several tabs at once' },
        { id: 'backend', title: 'Backend services' },
        { id: 'requests', title: 'Request logging' },
        { id: 'request-tabs', title: 'Request tabs' },
        { id: 'token', title: 'Where the token goes' },
        { id: 'diagnostics', title: 'Diagnostics' },
        { id: 'container', title: 'The container' }
      ]
    },
    {
      title: 'Working on Swiss',
      sections: [
        { id: 'setup', title: 'Set up' },
        { id: 'commands', title: 'Commands' },
        { id: 'source', title: 'Reading the source' },
        { id: 'conventions', title: 'Conventions' },
        { id: 'testing', title: 'Testing' },
        { id: 'changes', title: 'Making changes' },
        { id: 'rules', title: 'Rules the code relies on' },
        { id: 'contributing', title: 'Changelog and commits' },
        { id: 'shipping', title: 'Releasing' }
      ]
    }
  ];
  const sections = parts.flatMap((part) => part.sections);

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

  /**
   * Search. The page is hand-written markup, so the text searched is read
   * from the rendered sections once they exist. A section matches when every
   * word typed appears in its title or its text; the contents keep only
   * matching sections, and the matches in the page are marked through the CSS
   * Custom Highlight API where the browser has it.
   */
  let query = $state('');
  let article = $state<HTMLElement>();
  let sectionText = $state(new Map<string, string>());

  const terms = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));
  const searching = $derived(terms.length > 0);

  function matches(section: { id: string; title: string }): boolean {
    const text = `${section.title} ${sectionText.get(section.id) ?? ''}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  }

  const results = $derived(
    parts
      .map((part) => ({ ...part, sections: part.sections.filter((s) => !searching || matches(s)) }))
      .filter((part) => part.sections.length > 0)
  );
  const firstResult = $derived(results[0]?.sections[0]);

  onMount(() => {
    sectionText = new Map(
      sections.map((section) => [
        section.id,
        (document.getElementById(section.id)?.textContent ?? '').replace(/\s+/g, ' ')
      ])
    );
  });

  $effect(() => {
    if (!article || !searching) return;
    return paintHighlight(SEARCH_HIGHLIGHT, findText(article, terms));
  });

  function onSearchKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && firstResult) {
      event.preventDefault();
      location.hash = firstResult.id;
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      query = '';
    }
  }

  /**
   * Every card on the page: the principles, the Legend, the
   * Diagnostics groups and the recipes. The one under the pointer takes the primary border and the
   * raised surface, so it is clear which one you are reading in a grid.
   */
  const card =
    'border-border bg-surface hover:border-primary hover:bg-surface-2 rounded-lg border motion-safe:transition-colors';

  // In run order: a group appears where its first check does.
  const checkGroups = [...new Set(ALL_CHECKS.map((check) => check.group))].map((group) => ({
    group,
    ...GROUP_LABELS[group],
    checks: ALL_CHECKS.filter((check) => check.group === group)
  }));
  const manualCount = ALL_CHECKS.filter((check) => check.id.startsWith('manual.')).length;

  const commands = [
    { cmd: 'npm run dev', what: 'Dev server with hot reload on port 4200' },
    {
      cmd: 'npm run dashboard',
      what: 'The dev server, opening Swiss in a browser tab once it is ready'
    },
    { cmd: 'npm run check', what: 'Type-check with svelte-check' },
    { cmd: 'npm run lint', what: 'ESLint and Prettier (npm run format fixes formatting)' },
    { cmd: 'npm run test:unit', what: 'Vitest unit tests' },
    { cmd: 'npx vitest run src/lib/oidc/id-token.test.ts', what: 'One unit test file' },
    { cmd: 'npx vitest run -t "falls back"', what: 'Unit tests whose name matches' },
    {
      cmd: 'npm run test:e2e',
      what: 'Playwright, Chromium and Firefox, against a production build previewed on port 4173'
    },
    {
      cmd: 'npx playwright test e2e/flow.spec.ts --project=chromium',
      what: 'One spec in one browser'
    },
    { cmd: 'npm run build && npm run preview', what: 'Production build into build/, and serve it' },
    {
      cmd: 'docker compose up -d --build',
      what: 'Swiss itself in nginx on port 4200, from your working tree'
    },
    {
      cmd: 'docker build -t swiss-on-fhir:ci . && sh docker/test-entrypoints.sh swiss-on-fhir:ci',
      what: "Feed hostile .env values to the container's entrypoint scripts"
    },
    {
      cmd: 'npm run conformance:up -- openid',
      what: 'Start a conformance suite in Docker (openid, inferno or all); conformance:down stops it'
    },
    {
      cmd: 'npm run test:conformance',
      what: 'Drive Swiss through the running suites and compare with conformance/expectations'
    },
    {
      cmd: 'npm run security:baseline',
      what: 'Passive security scan of the container build; security:full adds the active scan'
    }
  ];

  const sourceMap = [
    {
      dir: 'routes/',
      owns: 'One folder per page; little logic of their own. +layout.ts loads the runtime config first.',
      start: ['launch/+page.svelte', '+page.svelte (Session)', 'fhir/+page.svelte']
    },
    {
      dir: 'lib/auth/',
      owns: 'Sign-in flow, in-flight transaction, session and its storage.',
      start: ['flow.ts', 'transaction.ts', 'session.svelte.ts']
    },
    {
      dir: 'lib/oidc/',
      owns: 'OAuth and OIDC functions: PKCE, authorize URL, token requests, JWTs, ID token checks, iss check, Backend Services keys, claims glossary.',
      start: ['token.ts', 'id-token.ts', 'claims.ts']
    },
    {
      dir: 'lib/smart/',
      owns: 'Discovery, feature gates, launch context, scopes.',
      start: ['discovery.ts', 'scopes.ts', 'context.ts']
    },
    {
      dir: 'lib/config/',
      owns: 'Settings: fields, parsing, validation, layers, saved overrides.',
      start: ['fields.ts', 'config.svelte.ts', 'runtime.ts']
    },
    {
      dir: 'lib/diagnostics/',
      owns: 'Checks (a file per group), the runner, and the store with discovery results.',
      start: ['checks/discovery.ts', 'runner.ts', 'diagnostics.svelte.ts']
    },
    {
      dir: 'lib/http/',
      owns: 'probe(), exchange records and redaction, the log and its filters.',
      start: ['probe.ts', 'exchange.ts', 'log.svelte.ts']
    },
    {
      dir: 'lib/fhir/',
      owns: 'The FHIR console: request tabs, URLs, paging, OperationOutcome, 401/403 hints, known headers, XML.',
      start: ['client.ts', 'url.ts', 'operation-outcome.ts']
    },
    {
      dir: 'lib/components/',
      owns: 'Shared UI and this page’s diagrams. ui/ holds the small primitives.',
      start: ['TokenPanel.svelte', 'ExchangeLogDrawer.svelte', 'how-it-works/']
    },
    {
      dir: 'e2e/',
      owns: 'Playwright specs and their fixtures, run in Chromium and Firefox.',
      start: ['fixtures.ts', 'flow.spec.ts', 'diagnostics.spec.ts']
    }
  ];

  const fixtures = [
    {
      name: 'test',
      what: "Playwright's test, serving RUNTIME_CONFIG as /swiss-env.json on every page"
    },
    {
      name: 'stubDiscovery(page)',
      what: 'Stubs smart-configuration, openid-configuration, a JWKS, /metadata and a token endpoint, at https://fhir.test and https://idp.test'
    },
    {
      name: 'seedSession(page, overrides)',
      what: 'Writes a session into sessionStorage, so a spec starts signed in'
    },
    {
      name: 'diagnosticsFinished(page)',
      what: 'Waits for a Diagnostics run to end'
    }
  ];
</script>

<svelte:head>
  <title>Swiss on FHIR Documentation · Swiss on FHIR</title>
</svelte:head>

{#snippet files(list: string[])}
  <p class="text-fg-muted mt-4 mb-1.5 text-[11px] font-semibold tracking-wider uppercase">
    Related files
  </p>
  <ul class="flex flex-wrap gap-1.5">
    {#each list as file (file)}
      <li>
        <a
          href={sourceUrl(file)}
          target="_blank"
          rel="noopener noreferrer"
          title="Open {repoPath(file)} on the main branch, in a new tab"
          class="border-border-control bg-surface hover:border-primary hover:bg-surface-2 hover:text-primary inline-block rounded-full border px-2.5 py-0.5 font-mono text-xs motion-safe:transition-colors"
        >
          {file}
        </a>
      </li>
    {/each}
  </ul>
{/snippet}

<div class="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10">
  <!--
    On a wide screen the contents stay in view beside the page. The search box
    stays put and only the list of sections scrolls, so the list's scrollbar
    never lies over the box; the list keeps room on its right for that
    scrollbar, and room all round for the focus ring, which its scrolling
    would otherwise clip.
  -->
  <nav
    aria-label="On this page"
    class="mb-6 text-sm lg:sticky lg:top-[calc(var(--nav-height)+1.5rem)] lg:mb-0 lg:flex lg:max-h-[calc(100vh-var(--nav-height)-5.5rem)] lg:flex-col lg:self-start"
  >
    <div role="search" class="mb-4 lg:shrink-0">
      <SearchInput
        bind:value={query}
        onkeydown={onSearchKey}
        label="Search the documentation"
        describedby="search-status"
        placeholder="Search this page"
      />
      <p id="search-status" class="text-fg-muted mt-1.5 text-xs" aria-live="polite">
        {#if searching}
          {#if firstResult}
            {results.reduce((n, part) => n + part.sections.length, 0)} of {sections.length} sections.
            Enter jumps to the first.
          {:else}
            No section mentions “{query.trim()}”.
          {/if}
        {/if}
      </p>
    </div>
    <div class="lg:-mx-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:p-1 lg:pr-3">
      {#each results as part (part.title)}
        <p
          class="text-fg-muted mt-3 mb-2 text-[11px] font-semibold tracking-wider uppercase first:mt-0"
        >
          {part.title}
        </p>
        <ol class="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
          {#each part.sections as section (section.id)}
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
      {/each}
    </div>
  </nav>

  <article bind:this={article} class="hiw min-w-0">
    <header>
      <p class="text-primary font-mono text-xs">Swiss on FHIR {version}</p>
      <h1 class="mt-1 text-2xl font-semibold">Swiss on FHIR Documentation</h1>
      <p class="text-fg-muted mt-2">
        Swiss is a browser app for testing FHIR servers and their SMART on FHIR authorization
        servers. This page shows how its parts fit together and how to work on the code.
      </p>
      <div class="mt-6 grid gap-3 sm:grid-cols-3" data-testid="principles">
        <div class="{card} p-4">
          <h2 class="text-primary text-base font-semibold">Keeping the User informed</h2>
          <p class="text-fg-muted mt-1 text-sm">
            A wrong nonce, an unverifiable ID token or a mismatched issuer becomes a finding next to
            the token, never a blocked sign-in.
          </p>
        </div>
        <div class="{card} p-4">
          <h2 class="text-primary text-base font-semibold">Understanding your server</h2>
          <p class="text-fg-muted mt-1 text-sm">
            A capability missing from discovery is a warning. Only an explicit contradiction
            disables a control.
          </p>
        </div>
        <div class="{card} p-4">
          <h2 class="text-primary text-base font-semibold">Show every request</h2>
          <p class="text-fg-muted mt-1 text-sm">
            The authorization URL can be previewed, and every request is in the exchange log.
          </p>
        </div>
      </div>
      <p class="text-fg-muted mt-3 text-sm">
        Exception: bad deployment input, such as a control character in the container's
        <code>.env</code>, stops the container.
      </p>
      <p class="text-fg-muted mt-3 text-sm">
        Related files link to their source on <code>main</code>. Paths under <code>routes/</code>
        are in <code>src/</code>, other source is in <code>src/lib/</code>, and a path starting with
        a top-level folder such as <code>docker/</code> is from the repository root.
      </p>

      <div class="{card} mt-5 p-4" data-testid="legend">
        <h2 id="legend" class="text-primary text-base font-semibold">Legend</h2>
        <ul
          class="text-fg-muted mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm"
          aria-labelledby="legend"
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
            <span class="dashed"></span>A browser/ user navigation
          </li>
        </ul>
      </div>
    </header>

    <p class="part">How it works</p>

    <section id="shape">
      <h2>The Swiss layout</h2>
      <ul class="points">
        <li>Client-side SPA, served by nginx</li>
        <li>Logs stay in the browser; nothing goes back to a server</li>
      </ul>
      <Figure>
        <AppShape />
        {#snippet caption()}
          <strong>Swiss ships solely as an SPA.</strong> The container only hands your browser the
          app and <code>/swiss-env.json</code>, written from <code>.env</code> at startup. In the
          tab, pages read four stores, stores call library functions, and every request goes
          straight to your servers through <code>probe()</code>, which logs it. The dashed line is
          the sign-in redirect, which Swiss can preview but not read.
        {/snippet}
      </Figure>
      <ul class="points">
        <li>Built by SvelteKit with <code>adapter-static</code></li>
        <li>
          <code>routes/+layout.ts</code> sets <code>ssr = false</code> and
          <code>prerender = false</code>: nothing renders at build time
        </li>
        <li>Every route falls back to <code>index.html</code> (nginx <code>try_files</code>)</li>
        <li>
          Only runtime dependency: <code>jose</code> (ID token verification, client assertion signing)
        </li>
      </ul>
      {@render files([
        'routes/+layout.ts',
        'routes/+layout.svelte',
        'vite.config.ts',
        'docker/docker-entrypoint.d/',
        'docker/nginx.conf'
      ])}
    </section>

    <section id="imports">
      <h2>The component structure</h2>
      <ul class="points">
        <li>Shared state lives in four stores</li>
        <li>
          Svelte 5 rune classes (<code>$state</code>, <code>$derived</code>), one instance each; no
          <code>svelte/store</code>
        </li>
        <li>Everything else is a plain module</li>
      </ul>
      <Figure>
        <StoreImports />
        {#snippet caption()}
          <strong>The stores form a chain, and the libraries stand apart.</strong> A store imports
          only those to its right, so <code>config</code> can be read anywhere without a cycle.
          Libraries take their inputs, including an optional <code>fetchImpl</code>, as arguments;
          <code>fhir/client.ts</code> is the one module that imports a store, to log its requests.
        {/snippet}
      </Figure>
    </section>

    <section id="config">
      <h2>Configuration: Managing multiple sources</h2>
      <p>
        Every page reads <code>config.current</code>, the tab's environment, built per field from
        four layers; the higher layer wins.
      </p>
      <Figure>
        <ConfigLayers />
        {#snippet caption()}
          <strong>Layers stack per field.</strong> The Config screen labels each value with its
          layer; Default's own values are <code>.env</code>, and the launch layer is memory only.
          The client secret is kept apart: <code>sessionStorage</code> unless "remember" is chosen, and
          never in a launch's snapshot.
        {/snippet}
      </Figure>
      <ul class="points">
        <li>
          <strong>Fields:</strong> <code>FIELDS</code> in <code>config/fields.ts</code>, one row per
          setting
          <ul>
            <li>Label, help text, input kind, parser</li>
            <li>Whether it comes from <code>.env</code></li>
            <li>Whether changing it marks a session stale</li>
            <li>
              Read by the Config form and the runtime parser; the README table is synced by hand
            </li>
          </ul>
        </li>
        <li>
          <strong>Coercion:</strong> everything in <code>/swiss-env.json</code> is a string
          <ul>
            <li>
              Rendered by <code>40-swiss-config.sh</code> (container) or
              <code>scripts/render-config.mjs</code> (development)
            </li>
            <li>
              <code>config/coerce.ts</code> parses URLs, booleans, scopes and enums
            </li>
            <li>Detects unfilled placeholders</li>
            <li>Caps every value at <code>MAX_VALUE_LENGTH</code></li>
          </ul>
        </li>
        <li>
          <strong>Validation:</strong> <code>config/validate.ts</code>
          <ul>
            <li>Suspicious values are warnings, not errors</li>
            <li>Errors only for unusable states (e.g. no client ID)</li>
          </ul>
        </li>
        <li>
          <strong>Environments:</strong>
          <ul>
            <li>
              Each holds a FHIR server, an authorization server, a sign-in client (secret, scopes),
              a Backend Services client (scopes) and testing options
            </li>
            <li>
              All three launch types work in each; the default launch type picks the Launch page
              mode and which client the Config screen shows
            </li>
            <li>Default comes from <code>.env</code></li>
            <li>Create, copy, rename and delete on the Config screen; edits stored under the id</li>
            <li>The nav picker switches this tab's environment</li>
          </ul>
        </li>
        <li>
          <strong>Export and import:</strong> <code>environments/format.ts</code>
          <ul>
            <li>Export: every environment as a list, with public JWKS, never a private key</li>
            <li>Import: previewed, all-or-nothing per environment</li>
            <li>Settings go through the <code>/swiss-env.json</code> parser</li>
            <li>A name in use becomes a copy, or replaces that environment if asked</li>
            <li>A single 3.1-style configuration applies to the active environment</li>
          </ul>
        </li>
        <li>
          <strong>Switching:</strong> <code>environments/switch.ts</code>, in order
          <ul>
            <li>Stops a Diagnostics run and keeps its results for the old environment</li>
            <li>Forgets discovered endpoints</li>
            <li>Changes the configuration and loads the new environment's sessions and results</li>
            <li>Separate module because the config store cannot import the others</li>
          </ul>
        </li>
        <li>
          <strong>Launch layer:</strong> owned by the launch page
          <ul>
            <li>Applies an EHR launch's <code>iss</code> while the URL carries it</li>
            <li>Re-applies it over a newly chosen environment</li>
            <li>Clears it when the URL loses it or the page is left</li>
            <li>Offers to switch when <code>iss</code> is another environment's FHIR base</li>
          </ul>
        </li>
        <li>
          <strong>Client secret:</strong> own slot in <code>config/persist.ts</code>, not in
          <code>ConfigSnapshot</code>, read live only when a request needs it
        </li>
      </ul>
      {@render files([
        'config/config.svelte.ts',
        'config/fields.ts',
        'config/runtime.ts',
        'config/coerce.ts',
        'config/validate.ts',
        'config/persist.ts',
        'config/merge.ts',
        'scripts/render-config.mjs'
      ])}
    </section>

    <section id="discovery">
      <h2>Discovery: Reconciling multiple sources</h2>
      <p>
        Swiss reads up to three documents for the server's endpoints and decides per endpoint, in a
        fixed order of trust.
      </p>
      <Figure>
        <DiscoveryOrder />
        {#snippet caption()}
          <strong>The FHIR server outranks the identity provider.</strong> So
          <code>smart-configuration</code> beats <code>openid-configuration</code>. An EHR launch's
          <code>iss</code> is not a source: it changes the FHIR base through the launch layer.
        {/snippet}
      </Figure>
      <ul class="points">
        <li>
          <strong>When it runs:</strong>
          <ul>
            <li>On opening the Launch page and on a Diagnostics run, otherwise only on request</li>
            <li>Never on a settings edit (it would refetch on every keystroke)</li>
            <li>
              Skipped while <code>diagnostics.discovered</code> matches the configured FHIR base and issuer
            </li>
            <li>Concurrent callers share one run</li>
          </ul>
        </li>
        <li>
          <code>smart-configuration</code> is tried under the FHIR base, then at the host root
        </li>
        <li>Order of trust: <code>PRECEDENCE</code> in <code>smart/discovery.ts</code></li>
        <li>
          <code>advertisedValues()</code> returns every candidate for a key; the ID token check uses
          it to try the next <code>jwks_uri</code>, and says which one it verified against
        </li>
        <li>
          <strong>EHR launch:</strong> when <code>iss</code> names another server, Swiss uses the
          issuer that server's <code>smart-configuration</code> declares, never the configured one
        </li>
        <li>
          <code>diagnostics.discoveryStale</code> flags endpoints from another base or issuer; callers
          re-discover before using them
        </li>
      </ul>
      {@render files([
        'smart/discovery.ts',
        'diagnostics/diagnostics.svelte.ts',
        'smart/capabilities.ts'
      ])}
    </section>

    <section id="signin">
      <h2>Signing in: The authentication life cycle</h2>
      <ul class="points">
        <li>Authorization code flow with PKCE, built and checked by Swiss</li>
        <li>
          <code>auth/flow.ts</code>: <code>beginAuthorization</code> before the redirect,
          <code>completeCallback</code> after
        </li>
      </ul>
      <Figure>
        <SignInSequence />
        {#snippet caption()}
          <strong>Everything the callback needs is saved before the redirect.</strong> The step 2 transaction
          holds the PKCE verifier, redirect URI, endpoints and settings, so a mid-flow edit cannot break
          the exchange. A failed check in step 7 is a warning, never a blocked session, and the callback
          strips the code from the URL first so a reload cannot re-send it.
        {/snippet}
      </Figure>
      <ul class="points">
        <li>
          <strong>ID token:</strong> <code>oidc/id-token.ts</code>; failures are reported, not fatal
          <ul>
            <li>Asymmetric algorithms only</li>
            <li>Requires <code>sub</code>, <code>exp</code>, <code>iat</code></li>
            <li>Checks <code>iss</code>, <code>aud</code>, nonce</li>
          </ul>
        </li>
        <li>
          <strong>RFC 9207:</strong> <code>oidc/iss-parameter.ts</code> compares the redirect's
          <code>iss</code> with the discovered issuer and flags a server that advertises support but omits
          it
        </li>
        <li>
          <strong>Authorize URL:</strong> built by hand in <code>oidc/authorize.ts</code>
          <ul>
            <li>Previewed exactly on the Launch page</li>
            <li>Never carries the client secret</li>
            <li>The form of <code>aud</code> is a setting</li>
          </ul>
        </li>
        <li>
          <strong>Scopes:</strong> <code>adjustScopesForFlavor</code> sends <code>launch</code> on
          an EHR launch, <code>launch/patient</code> on a standalone one, never both, and reports the
          change
        </li>
      </ul>
      {@render files([
        'auth/flow.ts',
        'oidc/pkce.ts',
        'oidc/authorize.ts',
        'oidc/token.ts',
        'oidc/id-token.ts',
        'oidc/iss-parameter.ts',
        'routes/launch/+page.svelte',
        'routes/callback/+page.svelte',
        'e2e/flow.spec.ts'
      ])}
    </section>

    <section id="transaction">
      <h2>A launch lifecycle</h2>
      <ul class="points">
        <li>
          Stored in <code>sessionStorage</code> under <code>swiss.tx.v1.&lt;state&gt;</code>, with
          an index of recent states
        </li>
        <li>
          Four states; they stop a single-use code being sent twice (a confusing
          <code>invalid_grant</code>)
        </li>
      </ul>
      <Figure>
        <LaunchStates />
        {#snippet caption()}
          <strong>A state that matches nothing is not trusted.</strong> An <code>?error=</code> with
          an unknown <code>state</code> is shown as not from your launch, and nothing touches your session.
          Old transactions are pruned on load.
        {/snippet}
      </Figure>
      <ul class="points">
        <li>Older than 10 minutes: warned about, but the exchange is still attempted</li>
        <li>
          Read-back transactions pass <code>isAuthTransaction</code>, sessions
          <code>isPersistedSession</code>, before use
        </li>
      </ul>
      {@render files(['auth/transaction.ts', 'routes/callback/+page.svelte'])}
    </section>

    <section id="session">
      <h2>After sign-in: the session</h2>
      <ul class="points">
        <li>
          <strong>Slots:</strong> <code>auth/session.svelte.ts</code>, one per environment and
          launch type, under <code>swiss.session.v1.&lt;environment&gt;.&lt;launch type&gt;</code>
          <ul>
            <li>A Backend Services token sits beside a standalone one</li>
            <li>The Session page switches between them</li>
          </ul>
        </li>
        <li>
          <strong>Storage:</strong> a setting
          <ul>
            <li><code>sessionStorage</code> (default), <code>localStorage</code> or memory only</li>
            <li>Changing it moves stored sessions</li>
            <li>Sessions load after the configuration, since the setting decides where to look</li>
          </ul>
        </li>
        <li>
          <strong>In-flight requests</strong> (refresh, Backend Services token) capture their environment
          and slot before starting and write back there, never into whatever the tab shows by then
        </li>
        <li>
          <strong>Launch context:</strong> <code>smart/context.ts</code>
          <ul>
            <li>
              <code>patient</code>, <code>encounter</code>: token response, then ID token, then
              access token JWT
            </li>
            <li><code>fhirUser</code>: ID token first</li>
            <li>Records each value's source and notes disagreements</li>
          </ul>
        </li>
        <li>
          <strong>Scopes:</strong> <code>smart/scopes.ts</code> diffs requested against granted
          <ul>
            <li>
              SMART 1.0 (<code>.read</code>, <code>.write</code>) and 2.0 (<code>.cruds</code>)
              syntax
            </li>
            <li>A syntax change alone is not a reduction</li>
          </ul>
        </li>
        <li>
          <strong>Refresh:</strong> manual only, so a failure is visible
          <ul>
            <li>A refreshed ID token is re-checked, including an unchanged subject</li>
          </ul>
        </li>
        <li>
          <strong>Revoke:</strong> calls the revocation endpoint, refresh token first
        </li>
        <li>
          <strong>Log out:</strong> links to <code>end_session_endpoint</code> when advertised; otherwise
          Swiss discards its own tokens and says so
        </li>
      </ul>
      {@render files([
        'auth/session.svelte.ts',
        'auth/storage.ts',
        'smart/context.ts',
        'smart/scopes.ts',
        'routes/+page.svelte',
        'components/TokenPanel.svelte',
        'components/ClaimGlossary.svelte',
        'oidc/claims.ts'
      ])}
    </section>

    <section id="tabs">
      <h2>Several tabs at once</h2>
      <Figure>
        <TabScope />
        {#snippet caption()}
          <strong>A tab's own work stays in the tab.</strong> Each tab can use its own environment
          and session slot. Shared settings sync through the <code>storage</code> event, and refreshes
          take turns.
        {/snippet}
      </Figure>
      <p>
        These are browser tabs; the FHIR console's tabs are under
        <a href="#request-tabs">Request tabs</a>.
      </p>
      <ul class="points">
        <li>
          <strong>Tab id:</strong> <code>tabs.svelte.ts</code>
          <ul>
            <li>Survives a reload; used by the exchange log and refresh locks</li>
            <li>
              A duplicated tab whose id is live elsewhere takes a new one; the original keeps its
              log
            </li>
          </ul>
        </li>
        <li>Tabs talk over a <code>BroadcastChannel</code> (works over plain http)</li>
        <li>
          <strong>Per tab:</strong> environment, session slot, launches in flight, Diagnostics
          results, EHR launch layer
          <ul>
            <li>Tabs share a session only when session storage is set to local storage</li>
          </ul>
        </li>
        <li>
          <strong>Refresh token, one tab at a time:</strong>
          <ul>
            <li>Refresh and revoke take a Web Lock named after the token's fingerprint</li>
            <li>
              Then re-read stored tokens and use another tab's result rather than resend a rotated
              token (many servers revoke the whole family on reuse)
            </li>
            <li>
              The rotating tab also holds a <code>swiss.rt-spent.&lt;fingerprint&gt;</code> lock, since
              a storage write can arrive after the refresh lock
            </li>
            <li>Web Locks need a secure context: over plain http only the re-read runs</li>
          </ul>
        </li>
        <li>
          <strong>Rotated copies:</strong>
          <ul>
            <li>
              After a rotation the tab broadcasts the old token's fingerprint, never the token
            </li>
            <li>A tab holding a copy marks it spent</li>
            <li>Can be sent anyway, to test reuse detection</li>
          </ul>
        </li>
        <li>
          <strong>Settings sync</strong> through the <code>storage</code> event
          <ul>
            <li>A launch in flight keeps its snapshot</li>
            <li>The callback adds a finding if the client secret changed meanwhile</li>
          </ul>
        </li>
      </ul>
      {@render files(['tabs.svelte.ts', 'auth/session.svelte.ts', 'http/log-persist.ts'])}
    </section>

    <section id="backend">
      <h2>Backend services</h2>
      <p>
        The Launch page's third mode: the <code>client_credentials</code> grant with a signed JWT instead
        of a user.
      </p>
      <ul class="points">
        <li>
          <strong>Keys:</strong> <code>oidc/keys.ts</code>
          <ul>
            <li>Generates a non-extractable RS384 or ES384 key pair with Web Crypto</li>
            <li>Stored in IndexedDB (<code>swiss-keys</code>), one key per environment</li>
            <li>Exports the public JWKS for registering with the server</li>
          </ul>
        </li>
        <li>
          <strong>Token:</strong> <code>oidc/assertion.ts</code> signs the assertion with
          <code>jose</code> and requests the token; the result goes to the environment's Backend Services
          slot
        </li>
        <li>
          <strong>Import:</strong> <code>oidc/key-import.ts</code>, pasted or from an environments
          file
          <ul>
            <li>Private JWK or PKCS#8 PEM</li>
            <li>RSA 2048 bits or more, or EC P-384</li>
            <li>Stored non-extractable, like a generated key</li>
            <li>A PEM is read once as extractable to find its public half; that copy is dropped</li>
            <li>Anything else is refused with what to do about it</li>
          </ul>
        </li>
        <li>
          <strong><code>private_key_jwt</code> sign-ins:</strong> the same key serves standalone and
          EHR launches
          <ul>
            <li>
              <code>withClientAssertion</code> signs a fresh assertion per code exchange, refresh and
              revocation, aimed at that endpoint
            </li>
            <li>An assertion's <code>jti</code> must not repeat</li>
          </ul>
        </li>
      </ul>
      {@render files([
        'oidc/keys.ts',
        'oidc/key-import.ts',
        'oidc/assertion.ts',
        'components/BackendServices.svelte'
      ])}
    </section>

    <section id="requests">
      <h2>Request logging</h2>
      <ul class="points">
        <li>
          Discovery, token requests, Diagnostics probes and the FHIR console all go through
          <code>probe()</code>
        </li>
        <li><code>probe()</code> records the exchange and classifies the outcome</li>
        <li>The caller adds the record to the exchange log at the bottom of every page</li>
      </ul>
      <Figure>
        <RequestLog />
        {#snippet caption()}
          <strong>Only the redacted form ever reaches disk.</strong> The IndexedDB copy, which survives
          the redirect and reloads, masks secrets and tokens whatever the redaction setting. A failed
          request carries a diagnosis: likely cause, confidence and evidence.
        {/snippet}
      </Figure>
      <ul class="points">
        <li>
          <strong>Timeouts:</strong> every request has one
          <ul>
            <li>A caller's stop signal is combined with it, never substituted</li>
            <li>A stopped request is <code>aborted</code>: no diagnosis, no follow-up request</li>
          </ul>
        </li>
        <li>
          <strong>Filters</strong> (search, status chips) narrow the view; a download contains every entry
          in view
        </li>
        <li>
          <strong>Storage:</strong> one IndexedDB record per exchange, stamped with its tab and
          environment
          <ul>
            <li>A tab rewrites only its own records</li>
            <li>Max 200 per tab, 1000 in all; oldest go first</li>
          </ul>
        </li>
        <li>
          <strong>Drawer:</strong>
          <ul>
            <li>Shows this tab's entries for the current environment, or another, or all</li>
            <li>An entry is unredacted only when its own environment has redaction off</li>
          </ul>
        </li>
      </ul>
      {@render files([
        'http/probe.ts',
        'http/exchange.ts',
        'http/log.svelte.ts',
        'http/log-persist.ts',
        'http/log-filter.ts',
        'components/ExchangeLogDrawer.svelte'
      ])}
    </section>

    <section id="request-tabs">
      <h2>Request tabs</h2>
      <p>The FHIR console keeps several requests open, each in a tab on one environment.</p>
      <ul class="points">
        <li>
          <strong>The selected tab is always on Swiss's current environment:</strong>
          <ul>
            <li>
              Choosing a tab switches Swiss to its environment (same switch as the nav picker)
            </li>
            <li>
              Switching from the picker brings up a tab on that environment
              <ul>
                <li>None? An untouched tab moves to it</li>
                <li>A tab with a request in it stays, and a new tab opens beside it</li>
              </ul>
            </li>
          </ul>
        </li>
        <li>
          <strong>Each tab owns:</strong> method, query, body, formats and the last response
          <ul>
            <li>
              A request in flight finishes into the tab that sent it, with the token and headers it
              was sent with
            </li>
          </ul>
        </li>
        <li>
          <strong>Headers belong to the environment:</strong> tabs on one environment share them, so a
          key for one server is never sent from another's tab
        </li>
        <li>
          <strong>Persistence:</strong>
          <ul>
            <li>Requests survive a reload (session storage); responses do not</li>
            <li>The last set is also kept in local storage and seeds a new browser tab</li>
            <li>
              An unknown method, a malformed environment id or an over-long query drops the entry
            </li>
            <li>Writes and cross-origin token sending are re-enabled after a reload</li>
          </ul>
        </li>
        <li>
          <strong>Keyboard navigation:</strong>
          <ul>
            <li>Arrow keys, Home &amp; End - move focus between tabs</li>
            <li>Enter &amp; Space - select tab (switching stops the old environment's requests)</li>
            <li>Shift + arrow key - move tab</li>
          </ul>
        </li>
        <li>Drag a tab to reorder it; the order is kept</li>
        <li>Rename a tab by double-clicking or pressing F2 (max 64 characters)</li>
        <li>Close a tab with Delete or a middle click</li>
        <li>Max 20 tabs; closing the last leaves an empty one</li>
        <li>Deleting an environment closes its tabs</li>
      </ul>
      {@render files([
        'fhir/request-tabs.ts',
        'fhir/request-tabs.svelte.ts',
        'components/RequestTabStrip.svelte'
      ])}
    </section>

    <section id="token">
      <h2>Where the token goes</h2>
      <ul class="points">
        <li>The FHIR console attaches the access token only to the server it was issued for</li>
        <li>
          It follows the session, not the settings: editing the FHIR base or an EHR launch's
          <code>iss</code> does not move it
        </li>
        <li>
          <strong>Header editor:</strong>
          <ul>
            <li>
              An <code>Authorization</code> header replaces the session's token on that request
            </li>
            <li>Can build it from a Basic username and password (encoded) or a Bearer token</li>
            <li>
              Credential headers (<code>Authorization</code>, or named like a key, token, secret or
              password; the log's redaction test) go only to the FHIR base's origin unless allowed
            </li>
            <li>Stored credentials are wiped an hour after their last change</li>
          </ul>
        </li>
      </ul>
      <Figure>
        <TokenRouting />
        {#snippet caption()}
          <strong>Typed URLs and paging links are checked too.</strong> An absolute URL or a
          <code>Bundle.link[next]</code> on another host gets the token only once allowed for the page,
          and the console says when it was withheld. Writes (POST, PUT, PATCH, DELETE) need a switch per
          server.
        {/snippet}
      </Figure>
      <ul class="points">
        <li>
          <strong>401 / 403 hints:</strong> <code>fhir/denial.ts</code>
          <ul>
            <li>
              Works out the resource type and operation needed (a search on <code>Patient</code>, a
              read of <code>Patient/123</code>)
            </li>
            <li>No held scope allows it: names the scope that would</li>
            <li>
              A held scope allows it: the server refused a granted permission (e.g. a client
              registration missing scopes the token response echoes)
            </li>
            <li>
              Reads <code>WWW-Authenticate</code> (<code>insufficient_scope</code>, requested scope)
              when exposed to the browser, and says when it is not
            </li>
            <li>Computed when the response arrives; a later refresh does not rewrite it</li>
          </ul>
        </li>
      </ul>
      {@render files([
        'fhir/client.ts',
        'fhir/denial.ts',
        'fhir/url.ts',
        'fhir/operation-outcome.ts',
        'fhir/header-rows.ts',
        'components/HeaderEditor.svelte',
        'routes/fhir/+page.svelte'
      ])}
    </section>

    <section id="diagnostics">
      <h2>Diagnostics</h2>
      <ul class="points">
        <li>{ALL_CHECKS.length} checks in a fixed order</li>
        <li>A check is skipped, by name, when one it depends on fails</li>
        <li>{manualCount} cannot be checked from a browser and say what to check instead</li>
        <li>Each result carries the raw requests behind it</li>
      </ul>
      <Figure>
        <DiagnosticsOrder />
        {#snippet caption()}
          <strong>The order is the narrative.</strong> Environment (no network), then documents, server
          support and reachability, then, with a session, what the server issued. Manual checks run last;
          the diagram and list below are drawn from the checks themselves.
        {/snippet}
      </Figure>

      <div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="check-inventory">
        {#each checkGroups as group (group.group)}
          <div class="{card} min-w-0 p-3">
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
      <ul class="points">
        <li>
          <strong>A check:</strong> <code>id</code>, <code>title</code>, <code>group</code>,
          optional
          <code>dependsOn</code>, and <code>run(ctx)</code> returning a <code>result()</code>
          <ul>
            <li>One file per group in <code>diagnostics/checks/</code></li>
            <li><code>checks/index.ts</code> sets the order</li>
          </ul>
        </li>
        <li>
          <strong><code>DiagnosticsContext</code>:</strong> configuration, discovery documents, endpoints,
          feature gates and a few session facts, never the session itself
        </li>
        <li>
          <strong>Results:</strong> the raw <code>HttpExchange</code>s plus remediation text from
          <code>diagnostics/remediation.ts</code>
        </li>
        <li>
          <strong><code>mutating</code> checks</strong> change the server, so run only on a click
        </li>
        <li>
          <strong>Fake code probe:</strong> the CORS group sends a fake authorization code to the
          token endpoint
          <ul>
            <li>No readable response: CORS problem</li>
            <li><code>invalid_client</code>: client registration problem</li>
            <li><code>invalid_grant</code>: healthy</li>
          </ul>
        </li>
      </ul>
      {@render files([
        'diagnostics/checks/*.ts',
        'diagnostics/runner.ts',
        'diagnostics/types.ts',
        'diagnostics/remediation.ts',
        'diagnostics/groups.ts',
        'diagnostics/filter.ts',
        'routes/diagnostics/+page.svelte'
      ])}
    </section>

    <section id="container">
      <h2>The container</h2>
      <ul class="points">
        <li>
          Two-stage build: Node builds the app, <code>nginxinc/nginx-unprivileged</code> serves it on
          port 8080 as non-root
        </li>
        <li>
          No configuration baked in (<code>render-config --defaults-only</code>); CI checks it
        </li>
        <li>
          <strong>Startup scripts:</strong>
          <ul>
            <li>
              <code>40-swiss-config.sh</code> writes <code>/swiss-env.json</code> from the environment
            </li>
            <li>
              <code>41-swiss-security-headers.sh</code> writes the security headers:
              <code>frame-ancestors</code> from <code>FRAME_ANCESTORS</code>, <code>nosniff</code>,
              <code>no-referrer</code>, HSTS, a Permissions-Policy refusing camera, microphone,
              location and the like, same-origin Cross-Origin-Opener-Policy; CI checks every
              location
            </li>
            <li>
              <code>42-swiss-environments.sh</code> serves a deployment's environments file (below)
            </li>
          </ul>
        </li>
        <li>
          <strong>Bad input:</strong> a control character or over-long value stops
          <code>40</code> and <code>41</code> with a <code>swiss: FATAL:</code> line naming the
          variable, never the value; <code>docker/test-entrypoints.sh</code> feeds them hostile values
          in CI
        </li>
        <li>
          <strong><code>FRAME_ANCESTORS</code></strong> (for a launch inside an EHR's frame):
          <ul>
            <li>Default: Swiss itself and the public SMART test launcher</li>
            <li>
              Space-separated, <code>self</code> and <code>none</code> unquoted:
              <code>FRAME_ANCESTORS=self https://ehr.example.org</code>
            </li>
            <li>A launch that opens Swiss in a new tab needs nothing</li>
            <li>
              Chromium-based browsers refuse a public site framing <code>http://localhost</code>;
              test framing against a deployed Swiss over HTTPS
            </li>
            <li>The Config screen shows the value being sent, read-only</li>
          </ul>
        </li>
        <li>
          <strong>Deployment environments:</strong>
          <ul>
            <li>
              Mount a file in the Config screen's export format at
              <code>/etc/swiss-environments/environments.json</code>, read-only and world-readable
            </li>
            <li>Served at <code>/swiss-environments.json</code></li>
            <li>Its environments appear beside Default, read-only, with browser edits on top</li>
            <li><code>defaultEnvironment</code> picks where a first visit starts</li>
            <li>An environment may carry a Backend Services key</li>
            <li>
              The script refuses a directory at that path (Docker's leftover when the host file is
              missing), a file over 1,000,000 bytes, or a non-object JSON; the app reports anything
              else on the Config screen
            </li>
            <li>No file: nginx answers 404, not the app shell</li>
            <li>Served to anyone who can reach Swiss; the app warns about secrets or keys in it</li>
            <li>
              Without file mounts: <code>FROM</code> this image and <code>COPY</code> the file to the
              same path
            </li>
          </ul>
        </li>
      </ul>
      {@render files([
        'Dockerfile',
        'docker/nginx.conf',
        'docker/docker-entrypoint.d/',
        'environments/deployment.ts',
        'docker/security-headers.conf.template',
        'config/env.template.json',
        'compose.yaml'
      ])}
    </section>

    <p class="part">Working on Swiss</p>

    <section id="setup">
      <h2>Set up</h2>
      <p>You need Node 22.17 or newer.</p>
      <pre><code
          >cp .env.example .env
npm install
npm run dev</code
        ></pre>
      <ul class="points">
        <li>
          Port 4200 is fixed: client registrations use <code>http://localhost:4200/callback</code>
        </li>
        <li>
          <code>npm run dev</code> renders <code>.env</code> into
          <code>static/swiss-env.json</code>; restart it after editing <code>.env</code>
        </li>
        <li>
          Use <code>http://localhost</code>, not <code>http://192.168.x.x</code>: PKCE needs
          <code>crypto.subtle</code>, which needs a secure context
        </li>
      </ul>
      <h3>Servers to test against</h3>
      <ul class="points">
        <li>
          <strong>Defaults in <code>.env.example</code>:</strong>
          <ul>
            <li>SMART authorization server: <code>http://localhost:9200</code></li>
            <li>FHIR server it protects: <code>http://localhost:8000</code></li>
            <li>
              Public client <code>swiss</code>, redirect URI
              <code>http://localhost:4200/callback</code>
            </li>
          </ul>
        </li>
        <li>
          <strong>Public SMART sandbox:</strong> accepts any client ID and redirect URI. Copy a
          launch URL from its page (settings live in its <code>/sim/</code> segment);
          <code>.do/app.yaml</code> has a decoded example.
        </li>
      </ul>
    </section>

    <section id="commands">
      <h2>Commands</h2>
      <div class="border-border mt-4 overflow-x-auto rounded-lg border">
        <table class="w-full min-w-160 text-sm">
          <thead class="bg-surface text-fg-muted text-left text-[11px] tracking-wider uppercase">
            <tr>
              <th class="px-3 py-2 font-semibold">Command</th>
              <th class="px-3 py-2 font-semibold">What it does</th>
            </tr>
          </thead>
          <tbody>
            {#each commands as row (row.cmd)}
              <tr class="border-border border-t align-top">
                <td class="px-3 py-2 font-mono text-xs break-all">{row.cmd}</td>
                <td class="px-3 py-2">{row.what}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <ul class="points">
        <li>
          CI runs lint, type-check, unit tests, build, end-to-end and container tests; run the first
          three before pushing
        </li>
        <li>First end-to-end run: <code>npx playwright install chromium firefox</code></li>
        <li>
          Playwright reuses a server on port 4173; a stale <code>vite preview</code> there means an old
          build
        </li>
        <li>
          Leave <code>CFFIXED_USER_HOME</code> in <code>playwright.config.ts</code>: Firefox on
          macOS 27 needs it
        </li>
      </ul>
    </section>

    <section id="source">
      <h2>Reading the source</h2>
      <ul class="points">
        <li>Static SvelteKit app; only runtime dependency is <code>jose</code></li>
        <li>
          Pages in <code>src/routes/</code>, the rest in <code>src/lib/</code> (<code>#lib/…</code>)
        </li>
        <li>Unit tests beside the code as <code>*.test.ts</code></li>
      </ul>
      <div class="border-border mt-4 overflow-x-auto rounded-lg border">
        <table class="w-full min-w-160 text-sm">
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
      <ul class="points">
        <li>
          <strong>Outside <code>src/</code>:</strong>
          <ul>
            <li><code>docker/</code>, <code>Dockerfile</code> - the image</li>
            <li><code>config/env.template.json</code> - settings read from <code>.env</code></li>
            <li><code>scripts/render-config.mjs</code> - renders them in development</li>
            <li><code>.github/workflows/</code> - CI and release</li>
            <li><code>.do/app.yaml</code> - the hosted app</li>
          </ul>
        </li>
      </ul>
    </section>

    <section id="conventions">
      <h2>Conventions</h2>
      <ul class="points">
        <li>
          <strong>Stores are classes:</strong> private <code>$state</code>, <code>readonly</code>
          <code>$derived</code> values, methods, one exported instance. Copy
          <code>http/log.svelte.ts</code>.
        </li>
        <li>
          <strong>Inject dependencies:</strong> request functions take an optional
          <code>fetchImpl</code>; tests pass a fake, not a global mock
        </li>
        <li>
          <strong>UI text:</strong> use the user's words, say what a button does, and make errors say
          what went wrong and how to fix it
        </li>
      </ul>
    </section>

    <section id="testing">
      <h2>Testing</h2>
      <h3>Unit tests</h3>
      <ul class="points">
        <li>Vitest in Node, no DOM: test libraries here, store-dependent code end-to-end</li>
        <li>
          Fake <code>fetchImpl</code>: answer expected URLs, refuse the rest (see
          <code>oidc/id-token.test.ts</code>)
        </li>
        <li>
          Checks: hand-build a <code>DiagnosticsContext</code> (see
          <code>checks/capabilities.test.ts</code>)
        </li>
      </ul>
      <h3>End-to-end tests</h3>
      <p>
        Playwright, Chromium and Firefox, on a production build. <code>e2e/fixtures.ts</code> provides:
      </p>
      <div class="border-border mt-3 overflow-x-auto rounded-lg border">
        <table class="w-full min-w-160 text-sm">
          <thead class="bg-surface text-fg-muted text-left text-[11px] tracking-wider uppercase">
            <tr>
              <th class="px-3 py-2 font-semibold">Fixture</th>
              <th class="px-3 py-2 font-semibold">What it does</th>
            </tr>
          </thead>
          <tbody>
            {#each fixtures as row (row.name)}
              <tr class="border-border border-t align-top">
                <td class="text-primary px-3 py-2 font-mono text-xs whitespace-nowrap"
                  >{row.name}</td
                >
                <td class="px-3 py-2">{row.what}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <ul class="points">
        <li>
          Most specs seed a session; <code>e2e/flow.spec.ts</code> signs in for real against a stub that
          checks PKCE and signs ID tokens. Add sign-in scenarios there.
        </li>
        <li>Open token panels (<code>&lt;details&gt;</code>) before asserting on their notes</li>
        <li>
          Phone viewport:
          <code>test.use(&#123; viewport: &#123; width: 402, height: 874 &#125; &#125;)</code>
          (<code>e2e/responsive.spec.ts</code>)
        </li>
        <li>
          <strong><code>e2e/security.spec.ts</code>:</strong>
          <ul>
            <li>No credential in a URL, <code>localStorage</code> or the stored log</li>
            <li>No link from a discovered <code>javascript:</code> URL</li>
            <li>No markup injected by an environments file</li>
          </ul>
        </li>
      </ul>
      <h3 id="conformance">Conformance runs</h3>
      <ul class="points">
        <li>
          Docker suites in <code>conformance/</code>, own Playwright project, local only (not
          <code>test:e2e</code>, not CI)
        </li>
        <li>Swiss is set up by an imported environments file and driven through its pages</li>
        <li>
          <strong>OpenID Connect RP suite:</strong> one fault per test (wrong issuer, missing claim,
          bad signature, no <code>kid</code>)
        </li>
        <li>
          <strong>SMART client suite:</strong> public, confidential symmetric, confidential asymmetric,
          Backend Services
        </li>
        <li>
          <strong>Negative tests:</strong> judged on Swiss's finding; the harness calls UserInfo only
          when Swiss reported nothing
        </li>
        <li>
          <strong><code>conformance/expectations/</code>:</strong> expected outcome, finding and
          reason per test; any difference fails. <code>UPDATE_EXPECTATIONS=1</code> records a run.
        </li>
        <li>
          <strong>FHIR base:</strong> Swiss itself for the OpenID suite (it fails on unexpected requests);
          a CORS proxy in front of the SMART suite
        </li>
        <li>
          <strong>Security scan:</strong> <code>scripts/security-scan.mjs</code> scans the shipping
          image on a private network, with and without an environments file. Every alert needs a
          reasoned row in <code>conformance/owasp/rules.tsv</code>; unlisted or FAIL fails the run.
        </li>
        <li>
          <strong>Reports:</strong> <code>conformance/results/</code>, git-ignored
        </li>
      </ul>
    </section>

    <section id="changes">
      <h2>Making changes</h2>
      <div class="mt-4 grid gap-3 md:grid-cols-2" data-testid="recipes">
        <div class="{card} p-4">
          <h3 class="text-sm font-semibold">Add a diagnostic check</h3>
          <ol class="steps">
            <li>
              Write a <code>Check</code> in <code>diagnostics/checks/</code>: <code>id</code>,
              <code>title</code>, <code>group</code>, <code>run(ctx)</code> returning
              <code>result(&#123; status, summary &#125;)</code>.
            </li>
            <li>Append it to the file's array; position is report order.</li>
            <li>
              <code>dependsOn</code> for a prerequisite check; <code>mutating: true</code> if it changes
              the server.
            </li>
            <li>
              Request via <code>probe()</code> with <code>ctx.fetchImpl</code>; return the
              exchanges.
            </li>
            <li>
              Fix-it text: <code>REMEDIATIONS</code> in <code>diagnostics/remediation.ts</code>.
            </li>
            <li>Unit test with a hand-built context. This page lists it automatically.</li>
          </ol>
        </div>
        <div class="{card} p-4">
          <h3 class="text-sm font-semibold">Add a setting</h3>
          <ol class="steps">
            <li>
              Key in <code>AppConfig</code> (<code>config/types.ts</code>), safe default in
              <code>config/defaults.ts</code>.
            </li>
            <li>
              Row in <code>FIELDS</code> (<code>config/fields.ts</code>): <code>label</code>,
              <code>help</code>, <code>kind</code>, <code>parse</code>, <code>authCritical</code>,
              <code>emptyMeansUnset</code>.
            </li>
            <li>
              From <code>.env</code>: set <code>envKey</code>; add it to
              <code>config/env.template.json</code>, <code>40-swiss-config.sh</code> (validated list
              and JSON), <code>.env.example</code> and the README's settings table.
            </li>
            <li>Run <code>docker/test-entrypoints.sh</code> against a fresh image.</li>
          </ol>
        </div>
        <div class="{card} p-4">
          <h3 class="text-sm font-semibold">Explain a claim or header parameter</h3>
          <ol class="steps">
            <li>
              Add to <code>DEFINITIONS</code> or <code>HEADER_DEFINITIONS</code> in
              <code>oidc/claims.ts</code>.
            </li>
            <li>
              Give a one-sentence summary and spec section (<code>claims.test.ts</code> checks).
            </li>
          </ol>
        </div>
        <div class="{card} p-4">
          <h3 class="text-sm font-semibold">Test a sign-in scenario</h3>
          <ol class="steps">
            <li>Add a case to <code>e2e/flow.spec.ts</code>.</li>
            <li>
              Set stub options: wrong nonce, missing <code>iss</code>, another key, dead
              <code>jwks_uri</code>.
            </li>
            <li>Assert on what Swiss shows, and that the session survives.</li>
          </ol>
        </div>
        <div class="{card} p-4">
          <h3 class="text-sm font-semibold">Add a page</h3>
          <ol class="steps">
            <li>
              Create <code>src/routes/&lt;name&gt;/+page.svelte</code>; add it to <code>items</code>
              in
              <code>components/Nav.svelte</code>.
            </li>
            <li>The layout supplies nav, exchange log drawer, session status and clock.</li>
            <li>Add it to <code>e2e/responsive.spec.ts</code> (no sideways scroll at 402px).</li>
          </ol>
        </div>
        <div class="{card} p-4">
          <h3 class="text-sm font-semibold">Document a FHIR server</h3>
          <ol class="steps">
            <li>Add a folder of its settings under <code>fhirserverinstructions/</code>.</li>
            <li>Link it from the README's "Working with FHIR servers", not the app.</li>
          </ol>
        </div>
      </div>
    </section>

    <section id="rules">
      <h2>Rules the code relies on</h2>
      <ul class="rules">
        <li>
          Every request goes through <code>probe()</code>; a bare <code>fetch</code> skips the exchange
          log.
        </li>
        <li>No discovery from an <code>$effect</code> on settings: it fires per keystroke.</li>
        <li>
          Token destination: session's <code>configSnapshot.fhirBaseUrl</code>, never
          <code>config.current.fhirBaseUrl</code>.
        </li>
        <li>
          Before using <code>diagnostics.endpoints</code>, re-discover if
          <code>diagnostics.discoveryStale</code>.
        </li>
        <li>
          URLs from a server or link pass <code>httpUrl()</code> before navigating or linking.
        </li>
        <li>
          Storage and server text are untrusted: validate reads; build objects from outside keys
          with a <code>Map</code> or <code>Object.fromEntries</code>.
        </li>
        <li>
          No secret on disk or in a URL: client secret stays out of snapshots and the authorization
          URL; exchanges are redacted before saving.
        </li>
        <li>Checks report, never block. Only bad deployment input stops the container.</li>
      </ul>
    </section>

    <section id="contributing">
      <h2>Changelog and commits</h2>
      <ul class="points">
        <li>
          <strong>Changelog:</strong> each user-facing change, from the user's side, in
          <code>CHANGELOG.md</code> under <code># Unreleased</code> as Added, Changed or Fixed
        </li>
        <li>
          <strong>Commits:</strong> imperative subject naming the effect ("Keep the exchange log bar on
          one line on a phone"); body says why
        </li>
        <li><strong>Pull requests:</strong> against <code>main</code>; CI must pass to merge</li>
      </ul>
    </section>

    <section id="shipping">
      <h2>Releasing</h2>
      <ul class="points">
        <li>A release is a version tag</li>
        <li>Nothing publishes until full CI passes on the tagged commit</li>
        <li>The hosted copy then updates itself</li>
      </ul>
      <pre><code>npm version 3.2.0 &amp;&amp; git push --follow-tags</code></pre>
      <ol class="steps">
        <li>Move <code># Unreleased</code> in <code>CHANGELOG.md</code> to the new version.</li>
        <li>
          Run the command above: it bumps <code>package.json</code>, commits, tags and pushes.
        </li>
      </ol>
      <Figure>
        <ReleasePipeline />
        {#snippet caption()}
          <strong>One tag, four image tags.</strong> <code>v3.2.0</code> publishes
          <code>3.2.0</code>,
          <code>3.2</code>, <code>3</code> and <code>latest</code> (amd64, arm64). The hosted app
          runs
          <code>3</code>; the deploy job redeploys it and checks the live
          <code>/swiss-env.json</code>
          is rendered. Pre-releases (<code>v3.2.0-rc.1</code>) publish only their tag and don't
          deploy.
        {/snippet}
      </Figure>
      <ul class="points">
        <li>
          <strong>Registry overview:</strong> generated from the README each release; diagrams become
          links, relative links pin to the tag
        </li>
      </ul>
      {@render files([
        '.github/workflows/release.yml',
        '.github/workflows/ci.yml',
        '.github/workflows/dockerhub-readme.yml',
        'Dockerfile',
        '.do/app.yaml'
      ])}
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
  .hiw .part + section {
    margin-top: 0.75rem;
    border-top: 0;
    padding-top: 0;
  }
  .hiw .part {
    margin-top: 3.5rem;
    padding-top: 1rem;
    border-top: 2px solid var(--color-primary);
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hiw section > h2 {
    margin-bottom: 0.5rem;
    font-size: 1.25rem;
    font-weight: 600;
    text-wrap: balance;
  }
  .hiw section > h3 {
    margin-top: 1.5rem;
    font-size: 1rem;
    font-weight: 600;
  }
  .hiw section > p {
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
  .hiw pre {
    margin-top: 0.75rem;
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-surface);
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
  }
  .hiw pre code {
    background: none;
    padding: 0;
    font-size: inherit;
    overflow-wrap: normal;
    white-space: pre;
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
  .points {
    margin-top: 1rem;
    display: grid;
    gap: 0.6rem;
    font-size: 0.925rem;
    list-style: disc;
    padding-left: 1.25rem;
  }
  .points li::marker {
    color: var(--color-primary);
  }
  .points ul {
    margin-top: 0.3rem;
    display: grid;
    gap: 0.25rem;
    list-style: circle;
    padding-left: 1.25rem;
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
