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
  import { findText, paintHighlight, SEARCH_HIGHLIGHT } from '$lib/highlight';
  import Figure from '$lib/components/how-it-works/Figure.svelte';
  import SearchInput from '$lib/components/ui/SearchInput.svelte';
  import AppShape from '$lib/components/how-it-works/AppShape.svelte';
  import StoreImports from '$lib/components/how-it-works/StoreImports.svelte';
  import ConfigLayers from '$lib/components/how-it-works/ConfigLayers.svelte';
  import DiscoveryOrder from '$lib/components/how-it-works/DiscoveryOrder.svelte';
  import SignInSequence from '$lib/components/how-it-works/SignInSequence.svelte';
  import LaunchStates from '$lib/components/how-it-works/LaunchStates.svelte';
  import RequestLog from '$lib/components/how-it-works/RequestLog.svelte';
  import TokenRouting from '$lib/components/how-it-works/TokenRouting.svelte';
  import ReleasePipeline from '$lib/components/how-it-works/ReleasePipeline.svelte';
  import DiagnosticsOrder from '$lib/components/how-it-works/DiagnosticsOrder.svelte';

  /**
   * Swiss's developer documentation: how its parts fit together, one diagram
   * per mechanism, then how to set up, test, change and release it. It is
   * the only copy of this material, and it links nowhere outside the app.
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
        { id: 'backend', title: 'Backend services' },
        { id: 'requests', title: 'Request logging' },
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
    }
  ];

  const sourceMap = [
    {
      dir: 'routes/',
      owns: 'One folder per page. Pages read stores and call library functions, and hold little logic of their own. +layout.ts loads the runtime config before anything renders.',
      start: ['launch/+page.svelte', '+page.svelte (Session)', 'fhir/+page.svelte']
    },
    {
      dir: 'lib/auth/',
      owns: 'The sign-in: orchestration, the in-flight transaction, the established session and where it is stored.',
      start: ['flow.ts', 'transaction.ts', 'session.svelte.ts']
    },
    {
      dir: 'lib/oidc/',
      owns: 'OAuth and OpenID Connect building blocks, each a plain function: PKCE, the authorization URL, token requests, JWT decoding, ID token verification, the iss check, Backend Services keys and assertions, and the claims glossary.',
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
      owns: 'The checks (one file per group), the runner that orders and skips them, and the store that also holds discovery results.',
      start: ['checks/discovery.ts', 'runner.ts', 'diagnostics.svelte.ts']
    },
    {
      dir: 'lib/http/',
      owns: 'The one road out: probe(), the exchange record and its redaction, the log, its IndexedDB copy and the drawer’s filters.',
      start: ['probe.ts', 'exchange.ts', 'log.svelte.ts']
    },
    {
      dir: 'lib/fhir/',
      owns: "The FHIR console's request layer: URL building, paging, OperationOutcome parsing, server names, known headers, and reading XML responses into the same outline as JSON.",
      start: ['client.ts', 'url.ts', 'operation-outcome.ts']
    },
    {
      dir: 'lib/components/',
      owns: 'Shared UI: token panels, the glossary, the log drawer, check rows, the nav, and this page’s diagrams. ui/ holds the small primitives (Card, Alert, CopyButton, Spinner, Combobox, ToggleSwitch).',
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
      what: "Playwright's test, extended to serve a known /swiss-env.json (RUNTIME_CONFIG) on every page automatically"
    },
    {
      name: 'stubDiscovery(page)',
      what: 'Stubs smart-configuration, openid-configuration, a JWKS, /metadata and a token endpoint, at https://fhir.test and https://idp.test'
    },
    {
      name: 'seedSession(page, overrides)',
      what: 'Writes a session straight into sessionStorage, so a spec can start signed in'
    },
    {
      name: 'diagnosticsFinished(page)',
      what: 'Waits for a Diagnostics run to end before you assert on what follows it'
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
      <li class="border-border bg-surface rounded-full border px-2.5 py-0.5 font-mono text-xs">
        {file}
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
      <p class="text-fg-muted mt-2 max-w-3xl">
        Swiss is a browser app for testing FHIR servers and the SMART on FHIR authorization servers
        in front of them. It runs the sign-in itself, shows every request and token, and reports on
        a server's features & compatibility. The intent behind this page is to clarify the many
        components behind Swiss, diagramming how they work together, and how to read the code.
      </p>

      <div class="mt-6 grid gap-3 sm:grid-cols-3" data-testid="principles">
        <div class="{card} p-4">
          <h2 class="text-primary text-base font-semibold">Report, don't refuse</h2>
          <p class="text-fg-muted mt-1 text-sm">
            A wrong nonce, an unverifiable ID token or a mismatched issuer becomes a finding shown
            next to the token. Swiss's goal is not to enforce a specific design pattern, simply to
            document server behaviours and interactions.
          </p>
        </div>
        <div class="{card} p-4">
          <h2 class="text-primary text-base font-semibold">Advertise, don't block</h2>
          <p class="text-fg-muted mt-1 text-sm">
            Servers under-report what they support. A capability missing from a discovery document
            only produces a warning; only an explicit contradiction disables a control.
          </p>
        </div>
        <div class="{card} p-4">
          <h2 class="text-primary text-base font-semibold">Show every request</h2>
          <p class="text-fg-muted mt-1 text-sm">
            Swiss builds the authorization URL itself so you can preview it, and every HTTP request
            goes through one function whose record ends up in the exchange log.
          </p>
        </div>
      </div>
      <p class="text-fg-muted mt-3 max-w-3xl text-sm">
        The one deliberate exception: a bad deployment input, such as a control character in the
        container's <code>.env</code>, stops the container. That is an operator error, not a server
        under test, so it is refused rather than repaired.
      </p>
      <p class="text-fg-muted mt-3 max-w-3xl text-sm">
        Each section ends with its related files. Their paths are relative to <code>src/</code>
        unless they start with a top-level folder, such as <code>docker/</code>, <code>e2e/</code>
        or
        <code>scripts/</code>.
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
            <span class="dashed"></span>A browser navigation, not a request Swiss reads
          </li>
        </ul>
      </div>
    </header>

    <p class="part">How it works</p>

    <section id="shape">
      <h2>The Swiss layout</h2>
      <p>
        Swiss is designed as a client-side Single Page Application (SPA). The container serves the
        application via nginx. All data that is logged is saved locally to the user's browser tab.
        As this is a client-side SPA, nothing is logged back to a server.
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
      <p>
        SvelteKit builds the app with <code>adapter-static</code>. <code>routes/+layout.ts</code>
        sets <code>ssr = false</code> and <code>prerender = false</code>, so nothing is rendered at
        build time and every route falls back to <code>index.html</code>, which nginx serves with
        <code>try_files</code>. The only runtime dependency is <code>jose</code>, used to verify ID
        tokens and to sign the Backend Services client assertion.
      </p>
      {@render files([
        'routes/+layout.ts',
        'routes/+layout.svelte',
        'svelte.config.js',
        'docker/docker-entrypoint.d/',
        'docker/nginx.conf'
      ])}
    </section>

    <section id="imports">
      <h2>The component structure</h2>
      <p>
        Shared state lives in four stores. Each is a Svelte 5 class whose fields are
        <code>$state</code> and <code>$derived</code> runes, exported as a single instance; there is
        no <code>svelte/store</code>. Everything else is a plain module.
      </p>
      <Figure>
        <StoreImports />
        {#snippet caption()}
          <strong>The stores form a chain, and the libraries stand apart.</strong> Each store
          imports only the ones to its right, so <code>config</code>, which depends on nothing, can
          be read from anywhere without a cycle. The libraries take what they need as arguments,
          including an optional <code>fetchImpl</code>, which is what makes them unit-testable
          without a browser.
          <code>fhir/client.ts</code> is the one module outside the stores that imports one: it records
          its own requests into the exchange log.
        {/snippet}
      </Figure>
    </section>

    <section id="config">
      <h2>Configuration: Managing multiple sources</h2>
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
      <ul class="points">
        <li>
          <strong>One table drives every setting.</strong> <code>FIELDS</code> in
          <code>config/fields.ts</code> has one row per setting: its label, help text, input kind,
          parser, whether it comes from <code>.env</code>, and whether changing it marks a session
          stale. The Config form and the runtime parser both read it; the README's settings table is
          kept in step with it by hand.
        </li>
        <li>
          <strong>Everything from <code>/swiss-env.json</code> is a string</strong>, because it is
          rendered from environment variables: by <code>40-swiss-config.sh</code> in the container
          and <code>scripts/render-config.mjs</code> in development. <code>config/coerce.ts</code>
          turns those strings into URLs, booleans, scopes and enums, recognises a placeholder that was
          never filled in, and caps every value at <code>MAX_VALUE_LENGTH</code>.
        </li>
        <li>
          <strong>Validation warns rather than refuses.</strong> <code>config/validate.ts</code>
          reports a suspicious configuration as warnings, because Swiss must load one in order to diagnose
          it. Only unusable states, such as a missing client ID, are errors.
        </li>
        <li>
          <strong>The launch page owns the launch layer.</strong> It applies an EHR launch's
          <code>iss</code> while the URL carries it, and clears it when the URL loses it or the page is
          left.
        </li>
        <li>
          <strong>The client secret is read live.</strong> It is stored in its own slot by
          <code>config/persist.ts</code>, left out of <code>ConfigSnapshot</code>, and read from the
          store only when a request needs it.
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
      <ul class="points">
        <li>
          <strong><code>smart-configuration</code> is looked for twice.</strong> Under the FHIR base first,
          then at the host root, since servers put it in either place.
        </li>
        <li>
          <strong>Every candidate is kept.</strong> <code>advertisedValues()</code> returns every
          value any document gave for a key, so a caller can retry. The ID token check uses it to
          try the next <code>jwks_uri</code> when the preferred one does not answer.
        </li>
        <li>
          <strong>Runs are shared and skipped when current.</strong> Discovery is skipped while
          <code>diagnostics.discovered</code> matches the configured FHIR base and issuer, and
          callers asking at the same time share one run. The order of trust is
          <code>PRECEDENCE</code>
          in
          <code>smart/discovery.ts</code>.
        </li>
        <li>
          <strong>An EHR launch is discovered from its own server.</strong> When <code>iss</code>
          names a server other than the configured FHIR base, Swiss uses the issuer that server's
          <code>smart-configuration</code> declares, never the configured one.
        </li>
        <li>
          <strong>Endpoints are checked before use.</strong>
          <code>diagnostics.discoveryStale</code> says the held endpoints belong to another base or issuer,
          and anything about to use them re-discovers first.
        </li>
      </ul>
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
      <ul class="points">
        <li>
          <strong>The ID token is verified, and failures are reported.</strong>
          <code>oidc/id-token.ts</code> accepts only asymmetric algorithms, requires
          <code>sub</code>,
          <code>exp</code> and <code>iat</code>, and checks <code>iss</code>, <code>aud</code> and
          the nonce. <code>oidc/iss-parameter.ts</code> compares the redirect's <code>iss</code> with
          the discovered issuer, and notices a server that advertises RFC 9207 support and then leaves
          it out.
        </li>
        <li>
          <strong>The authorization URL is built by hand</strong> in <code>oidc/authorize.ts</code>,
          so the Launch page can preview it exactly. It never carries the client secret, and the
          form of
          <code>aud</code> is a setting, because servers disagree about it.
        </li>
        <li>
          <strong>Scopes follow the launch type.</strong> <code>adjustScopesForFlavor</code> sends
          <code>launch</code> on an EHR launch and <code>launch/patient</code> on a standalone one, never
          both, and reports what it changed.
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
      <p>
        Each launch is saved in <code>sessionStorage</code> under
        <code>swiss.tx.v1.&lt;state&gt;</code>, with a small index of recent states, and moves
        through four states. They exist to stop one mistake: sending a single-use authorization code
        twice and getting a confusing <code>invalid_grant</code>.
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
      <ul class="points">
        <li>
          <strong>An old launch is still tried.</strong> A transaction older than 10 minutes gets a warning,
          but the exchange is attempted: the server's answer says more than refusing locally.
        </li>
        <li>
          <strong>Storage is untrusted input.</strong> What is read back passes through
          <code>isAuthTransaction</code>, and sessions through <code>isPersistedSession</code>,
          before either is used.
        </li>
      </ul>
      {@render files(['auth/transaction.ts', 'routes/callback/+page.svelte'])}
    </section>

    <section id="session">
      <h2>After sign-in: the session</h2>
      <p>
        <code>auth/session.svelte.ts</code> holds the established session under
        <code>swiss.session.v1</code>. Where it is kept is a setting: <code>sessionStorage</code> by
        default,
        <code>localStorage</code>, or memory only.
      </p>
      <ul class="points">
        <li>
          <strong>Launch context</strong> comes from <code>smart/context.ts</code>:
          <code>patient</code> and <code>encounter</code> from the token response first, then the ID
          token, then the access token if it is a JWT, and <code>fhirUser</code> from the ID token first.
          It records each value's source and notes when sources disagree.
        </li>
        <li>
          <strong>Scopes</strong> are compared in <code>smart/scopes.ts</code>, requested against
          granted, in SMART 1.0 (<code>.read</code>, <code>.write</code>) and 2.0 (<code
            >.cruds</code
          >) syntax. A change of syntax alone is not reported as a reduction.
        </li>
        <li>
          <strong>Refresh is manual on purpose.</strong> A silent refresh that succeeds teaches nothing,
          and one that fails looks like a random logout. A refreshed ID token is checked again, including
          that its subject has not changed.
        </li>
        <li>
          <strong>Revoke and log out.</strong> Revoke calls the revocation endpoint, refresh token
          first. Log out links to <code>end_session_endpoint</code> when the server advertises one; otherwise
          Swiss can only discard its own tokens, and says so.
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

    <section id="backend">
      <h2>Backend services</h2>
      <p>
        The Launch page's third mode is the <code>client_credentials</code> grant with a signed JWT
        instead of a user. <code>oidc/keys.ts</code> generates a non-extractable RS384 or ES384 key
        pair with Web Crypto, keeps it in IndexedDB (<code>swiss-keys</code>), and exports the
        public JWKS for registering with the server. <code>oidc/assertion.ts</code> signs the client
        assertion with
        <code>jose</code> and requests the token, and the result becomes a session like any other.
      </p>
      {@render files(['oidc/keys.ts', 'oidc/assertion.ts', 'components/BackendServices.svelte'])}
    </section>

    <section id="requests">
      <h2>Request logging</h2>
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
      <ul class="points">
        <li>
          <strong>Every request has a timeout.</strong> A caller's stop signal is combined with it,
          never substituted for it, and a request stopped that way is recorded as
          <code>aborted</code>, with no diagnosis and no follow-up request.
        </li>
        <li>
          <strong>Filtering never changes downloads.</strong> The drawer's search and status chips narrow
          the view only; a download contains every entry.
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

    <section id="token">
      <h2>Where the token goes</h2>
      <p>
        The FHIR console attaches your access token only to the server it was issued for. It follows
        the session, not the settings: changing the FHIR base on the Config screen, or an EHR launch
        passing a different <code>iss</code>, does not move the token to a new server.
      </p>
      <p>
        An <code>Authorization</code> header added in the console's header editor replaces the
        session's token on that request. The editor can build it from a Basic username and password,
        which it encodes, or from a Bearer token. Credential headers you add (<code
          >Authorization</code
        >, and any header named like a key, token, secret or password, the same test the exchange
        log redacts by) follow the token's rule: they go only to the FHIR base's origin unless you
        allow another. If headers are stored in the browser, those credentials are kept for an hour
        after they were last changed and then wiped from storage and from the form.
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
      {@render files([
        'fhir/client.ts',
        'fhir/url.ts',
        'fhir/operation-outcome.ts',
        'fhir/header-rows.ts',
        'components/HeaderEditor.svelte',
        'routes/fhir/+page.svelte'
      ])}
    </section>

    <section id="diagnostics">
      <h2>Diagnostics</h2>
      <p>
        Diagnostics runs {ALL_CHECKS.length} checks in a fixed order, giving a structured report from
        the top down: what the browser allows, whether the documents load, whether the server supports
        what you are about to ask for & whether this page can reach it. A check that depends on another
        is skipped, by name, when that one fails. {manualCount} of them cannot be checked from a browser
        at all, and explain what to check instead. Each result carries the raw requests behind it, allowing
        you to manually verify the findings.
      </p>
      <Figure>
        <DiagnosticsOrder />
        {#snippet caption()}
          <strong>The order is the narrative.</strong> Environment checks need no network and come first;
          then whether the documents load, whether the server supports what you are about to ask for,
          and whether this page can reach it; then, with a session, whether what the server issued holds
          up. The manual checks run last, whatever group they are filed under. The diagram is drawn from
          the checks themselves, like the list below.
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
          <strong>A check is an object</strong> with an <code>id</code>, <code>title</code>,
          <code>group</code>, optional <code>dependsOn</code> and a <code>run(ctx)</code> that
          returns a
          <code>result()</code>. Each group has its own file in <code>diagnostics/checks/</code>,
          and
          <code>checks/index.ts</code> sets the order.
        </li>
        <li>
          <strong>The context is deliberately narrow.</strong> <code>DiagnosticsContext</code> exposes
          the configuration, the discovery documents, the endpoints, the feature gates and a few facts
          about the session, not the session itself, so each check's dependencies stay visible and testable.
        </li>
        <li>
          <strong>Every finding says what to change.</strong> Alongside the raw
          <code>HttpExchange</code>s behind it, a result carries remediation text from
          <code>diagnostics/remediation.ts</code>.
        </li>
        <li>
          <strong>Some checks wait for a click.</strong> A check marked <code>mutating</code> changes
          something on the server, so it only runs when asked.
        </li>
        <li>
          <strong>One probe sends a fake code on purpose.</strong> The CORS group sends a fake
          authorization code to the token endpoint. The answer tells a CORS problem (no readable
          response) from a client registration problem (<code>invalid_client</code>) from a healthy
          setup (<code>invalid_grant</code>).
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
      <p>
        The image is a two-stage build: Node builds the static app, then
        <code>nginxinc/nginx-unprivileged</code> serves it on port 8080 as a non-root user. The
        build bakes in no configuration (<code>render-config --defaults-only</code>), and CI checks
        that it did not.
      </p>
      <ul class="points">
        <li>
          <strong>Two scripts run at startup.</strong> <code>40-swiss-config.sh</code> writes
          <code>/swiss-env.json</code> from the environment, and
          <code>41-swiss-security-headers.sh</code>
          writes the security headers: <code>frame-ancestors</code> from
          <code>FRAME_ANCESTORS</code>, plus <code>nosniff</code>, <code>no-referrer</code>, HSTS, a
          Permissions-Policy that refuses camera, microphone, location and the like, and a
          same-origin Cross-Origin-Opener-Policy. CI checks that every location sends them.
        </li>
        <li>
          <strong>Both refuse bad input.</strong> A control character or an over-long value stops
          the container with a <code>swiss: FATAL:</code> line that names the variable, never its
          value.
          <code>docker/test-entrypoints.sh</code> feeds them hostile values in CI.
        </li>
      </ul>
      {@render files([
        'Dockerfile',
        'docker/nginx.conf',
        'docker/docker-entrypoint.d/',
        'docker/security-headers.conf.template',
        'config/env.template.json',
        'compose.yaml'
      ])}
    </section>

    <p class="part">Working on Swiss</p>

    <section id="setup">
      <h2>Set up</h2>
      <p>You need Node 22 or newer.</p>
      <pre><code
          >cp .env.example .env
npm install
npm run dev</code
        ></pre>
      <p>
        The dev server runs on <code>http://localhost:4200</code>, and the port is fixed on purpose:
        existing client registrations use <code>http://localhost:4200/callback</code>.
        <code>npm run dev</code> first renders <code>.env</code> into
        <code>static/swiss-env.json</code>, so restart it after editing <code>.env</code>. Use
        <code>http://localhost</code>, not your machine's network address: PKCE needs
        <code>crypto.subtle</code>, which browsers only provide in a secure context, and
        <code>http://192.168.x.x</code> is not one.
      </p>
      <h3>Servers to test against</h3>
      <p>
        Swiss needs a FHIR server, the SMART authorization server that protects it, and a public
        client registered for Swiss with the redirect URI <code>http://localhost:4200/callback</code
        >. The defaults in <code>.env.example</code> expect them on this machine: the authorization
        server on
        <code>http://localhost:9200</code>, the FHIR server on <code>http://localhost:8000</code>,
        and the client ID <code>swiss</code>. Any servers of that shape work with a fresh
        <code>.env</code>.
      </p>
      <p>
        For a public sandbox, the SMART App Launcher accepts any client ID and redirect URI. It
        reads its launch settings from a <code>/sim/</code> segment in its URL, so copy a launch URL
        from its page rather than using its bare FHIR base; <code>.do/app.yaml</code> has a working example
        with the segment decoded.
      </p>
    </section>

    <section id="commands">
      <h2>Commands</h2>
      <div class="border-border mt-4 overflow-x-auto rounded-lg border">
        <table class="w-full min-w-[640px] text-sm">
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
      <p>
        CI runs lint, type-check, unit tests, the build, the end-to-end tests and the container
        tests; run at least the first three before pushing. The first end-to-end run on a machine
        needs the browsers: <code>npx playwright install chromium firefox</code>.
      </p>
      <ul class="points">
        <li>
          <strong>Playwright reuses a server already on port 4173</strong> when run locally, so a
          stale
          <code>vite preview</code> left running there means you test an old build.
        </li>
        <li>
          <strong>On macOS 27, Firefox refuses its usual profile folder</strong> when launched from
          a terminal. <code>playwright.config.ts</code> works around it by setting
          <code>CFFIXED_USER_HOME</code>; leave that in place.
        </li>
      </ul>
    </section>

    <section id="source">
      <h2>Reading the source</h2>
      <p>
        Everything lives under <code>src/</code>: a SvelteKit app built to static files, with
        <code>jose</code> as its only runtime dependency. Pages are in <code>src/routes/</code>, and
        everything they use is under <code>src/lib/</code>, imported as <code>$lib/…</code>. Unit
        tests sit beside the code as <code>*.test.ts</code>.
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
      <p>
        Outside <code>src/</code>: <code>docker/</code> and the <code>Dockerfile</code> build the
        image;
        <code>config/env.template.json</code> lists the settings that come from <code>.env</code>;
        <code>scripts/render-config.mjs</code> renders them for development;
        <code>.github/workflows/</code> holds CI and the release; <code>.do/app.yaml</code> describes
        the hosted app.
      </p>
    </section>

    <section id="conventions">
      <h2>Conventions</h2>
      <ul class="points">
        <li>
          <strong>Stores are classes.</strong> Each keeps private <code>$state</code> fields,
          exposes
          <code>readonly</code> <code>$derived</code> values and methods, and its module exports one
          instance. Copy the shape of <code>http/log.svelte.ts</code> for a new one.
        </li>
        <li>
          <strong>Libraries take their dependencies as arguments.</strong> A function that makes
          requests accepts an optional <code>fetchImpl</code>, so tests pass a fake instead of
          mocking globals.
        </li>
        <li>
          <strong>Comments say why.</strong> The code records reasons, rejected alternatives and what
          the 2.x Angular app got wrong, next to the code they explain. A comment that only restates the
          code is noise.
        </li>
        <li>
          <strong>Every source file starts with the Apache 2.0 license header.</strong> Copy it from a
          neighbouring file, in that file type's comment syntax.
        </li>
        <li>
          <strong>Text in the UI is plain and specific.</strong> Name things the way the person using
          Swiss would, say what a button does, and make an error say what went wrong and how to fix it.
        </li>
        <li>
          <strong>The app stays server-agnostic.</strong> Keep product names out of its text; settings
          for a particular server belong in the repository's server instructions.
        </li>
      </ul>
    </section>

    <section id="testing">
      <h2>Testing</h2>
      <h3>Unit tests</h3>
      <p>
        Unit tests run in Vitest's Node environment, so there is no DOM. That suits the plain
        libraries, where most logic lives; anything that depends on a store is covered by an
        end-to-end test instead. Pass a fake <code>fetchImpl</code> that answers the URLs the code
        should request and refuses the rest:
        <code>oidc/id-token.test.ts</code> serves a real JWKS this way and signs tokens with
        <code>jose</code>. For a diagnostic check, build a <code>DiagnosticsContext</code> by hand,
        as
        <code>checks/capabilities.test.ts</code> does.
      </p>
      <h3>End-to-end tests</h3>
      <p>
        Playwright runs every spec in Chromium and Firefox against a production build.
        <code>e2e/fixtures.ts</code> provides:
      </p>
      <div class="border-border mt-3 overflow-x-auto rounded-lg border">
        <table class="w-full min-w-[640px] text-sm">
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
      <p>
        Most specs seed a session. <code>e2e/flow.spec.ts</code> is the exception: it drives a real authorize,
        redirect, callback and token exchange against a stub server that checks PKCE and signs ID tokens
        with a key it publishes. Add sign-in scenarios there.
      </p>
      <ul class="points">
        <li>
          <strong>Open token panels before asserting on their notes.</strong> They are collapsed
          <code>&lt;details&gt;</code> elements.
        </li>
        <li>
          <strong>Set the viewport for layout tests.</strong> For a phone, use
          <code>test.use(&#123; viewport: &#123; width: 402, height: 874 &#125; &#125;)</code>, as
          <code>e2e/responsive.spec.ts</code> does.
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
              Write a <code>Check</code> in the group's file under <code>diagnostics/checks/</code>,
              with an
              <code>id</code>, a <code>title</code>, its <code>group</code> and a
              <code>run(ctx)</code>
              that returns <code>result(&#123; status, summary &#125;)</code>.
            </li>
            <li>
              Append it to that file's array. Its position sets where it appears in the report.
            </li>
            <li>
              Set <code>dependsOn</code> if it only makes sense after another check passes, and
              <code>mutating: true</code> if it changes anything on the server.
            </li>
            <li>
              Make requests through <code>probe()</code> with <code>ctx.fetchImpl</code> and return
              the exchanges. Fix-it text goes in <code>REMEDIATIONS</code> in
              <code>diagnostics/remediation.ts</code>.
            </li>
            <li>Unit test it with a hand-built context. It appears on this page by itself.</li>
          </ol>
        </div>
        <div class="{card} p-4">
          <h3 class="text-sm font-semibold">Add a setting</h3>
          <ol class="steps">
            <li>
              Add the key to <code>AppConfig</code> in <code>config/types.ts</code> and a safe
              default in
              <code>config/defaults.ts</code>.
            </li>
            <li>
              Add one row to <code>FIELDS</code> in <code>config/fields.ts</code>:
              <code>label</code>,
              <code>help</code>, <code>kind</code>, <code>parse</code>, <code>authCritical</code>
              and
              <code>emptyMeansUnset</code>. The Config screen picks it up.
            </li>
            <li>
              If it comes from <code>.env</code>, set <code>envKey</code> and add it to
              <code>config/env.template.json</code>, to both the validated list and the JSON in
              <code>40-swiss-config.sh</code>, and to <code>.env.example</code> and the README's settings
              table.
            </li>
            <li>Run <code>docker/test-entrypoints.sh</code> against a fresh image.</li>
          </ol>
        </div>
        <div class="{card} p-4">
          <h3 class="text-sm font-semibold">Explain a claim or header parameter</h3>
          <ol class="steps">
            <li>
              Add a definition to <code>DEFINITIONS</code> or <code>HEADER_DEFINITIONS</code> in
              <code>oidc/claims.ts</code>.
            </li>
            <li>
              Give it a one-sentence summary and the specification section it comes from;
              <code>claims.test.ts</code> checks every entry has one.
            </li>
          </ol>
        </div>
        <div class="{card} p-4">
          <h3 class="text-sm font-semibold">Test a sign-in scenario</h3>
          <ol class="steps">
            <li>
              Add a case to <code>e2e/flow.spec.ts</code>, whose stub server checks PKCE and signs
              real ID tokens.
            </li>
            <li>
              Set the stub's options (a wrong nonce, a missing <code>iss</code>, another key, a dead
              <code>jwks_uri</code>) to produce the behaviour.
            </li>
            <li>Assert on what Swiss shows, and that the session still exists.</li>
          </ol>
        </div>
        <div class="{card} p-4">
          <h3 class="text-sm font-semibold">Add a page</h3>
          <ol class="steps">
            <li>
              Create <code>src/routes/&lt;name&gt;/+page.svelte</code> and add it to
              <code>items</code>
              in
              <code>components/Nav.svelte</code>.
            </li>
            <li>
              The layout already provides the nav, the exchange log drawer with the session status,
              and the shared clock.
            </li>
            <li>
              Add it to <code>e2e/responsive.spec.ts</code>, which checks no page scrolls sideways
              at 402px.
            </li>
          </ol>
        </div>
        <div class="{card} p-4">
          <h3 class="text-sm font-semibold">Document a FHIR server</h3>
          <ol class="steps">
            <li>
              Add a folder under <code>fhirserverinstructions/</code> with the settings that server needs.
            </li>
            <li>Link it from "Working with FHIR servers" in the README, not from the app.</li>
          </ol>
        </div>
      </div>
    </section>

    <section id="rules">
      <h2>Rules the code relies on</h2>
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
          Check <code>diagnostics.discoveryStale</code> before using
          <code>diagnostics.endpoints</code> for a request, and re-discover if it is set.
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
          Never let a secret reach disk or a URL: the client secret stays out of snapshots and the
          authorization URL, and exchanges are redacted before they are saved.
        </li>
        <li>
          New checks report; they do not block. Only a bad deployment input stops the container,
          because that is an operator error, not a server under test.
        </li>
      </ul>
    </section>

    <section id="contributing">
      <h2>Changelog and commits</h2>
      <ul class="points">
        <li>
          <strong>Changelog.</strong> Every user-facing change gets a line in
          <code>CHANGELOG.md</code>
          under
          <code># Unreleased</code>, grouped as Added, Changed or Fixed, written from the user's
          side.
        </li>
        <li>
          <strong>Commits.</strong> The subject describes the effect in the imperative, such as "Keep
          the exchange log bar on one line on a phone". The body explains why, and what was wrong before.
        </li>
        <li>
          <strong>Pull requests</strong> go against <code>main</code>, and CI must pass before
          merging.
        </li>
      </ul>
    </section>

    <section id="shipping">
      <h2>Releasing</h2>
      <p>
        A release is a version tag. Nothing is published until the full CI suite has passed on the
        tagged commit, and the hosted copy updates itself afterwards.
      </p>
      <pre><code>npm version 3.2.0 &amp;&amp; git push --follow-tags</code></pre>
      <p>
        That bumps <code>package.json</code>, commits and tags; move the <code># Unreleased</code>
        heading in
        <code>CHANGELOG.md</code> to the new version first.
      </p>
      <Figure>
        <ReleasePipeline />
        {#snippet caption()}
          <strong>One tag derives four image tags.</strong> A tag such as <code>v3.2.0</code>
          publishes
          <code>3.2.0</code>, <code>3.2</code>, <code>3</code> and <code>latest</code>, for amd64
          and arm64. The hosted app follows <code>3</code>, but App Platform cannot watch Docker
          Hub, so the deploy job asks it to redeploy, then checks that the live site serves a
          rendered
          <code>/swiss-env.json</code>. Pre-release tags such as <code>v3.2.0-rc.1</code> publish only
          their own tag and do not deploy.
        {/snippet}
      </Figure>
      <ul class="points">
        <li>
          <strong>The Docker Hub overview is generated from the README</strong> at each release, with
          diagrams replaced by links and relative links pinned to the release tag. Once an image is released,
          the deployed version pulls & serves the latest tagged Docker image.
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
  .hiw pre {
    margin-top: 0.75rem;
    max-width: 48rem;
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
    max-width: 48rem;
    font-size: 0.925rem;
    list-style: disc;
    padding-left: 1.25rem;
  }
  .points li::marker {
    color: var(--color-primary);
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
