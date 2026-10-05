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

# Developing Swiss

How to set up, find your way around the source, test, make the most common kinds of change, and release. Read [Architecture](architecture.md) first if you have not: it explains what the parts below are for.

- [Set up](#set-up)
- [Commands](#commands)
- [Finding your way around](#finding-your-way-around)
- [Conventions](#conventions)
- [Testing](#testing)
- [Common changes](#common-changes)
- [Rules the code relies on](#rules-the-code-relies-on)
- [Changelog, commits and pull requests](#changelog-commits-and-pull-requests)
- [Releasing](#releasing)

## Set up

You need Node 22 or newer.

```bash
cp .env.example .env
npm install
npm run dev
```

The dev server runs on **http://localhost:4200**, and the port is fixed on purpose: every existing client registration uses `http://localhost:4200/callback`. `npm run dev` first renders `.env` into `static/swiss-env.json` (`scripts/render-config.mjs`); after editing `.env`, restart it.

Use `http://localhost`, not your machine's network address. PKCE needs `crypto.subtle`, which browsers only provide in a secure context, and `http://localhost` counts as one while `http://192.168.x.x` does not.

### Servers to test against

The defaults in `.env.example` describe a local stack: an authorization server on `http://localhost:9200`, a FHIR server on `http://localhost:8000`, and a public client registered as `swiss`. A ready-made stack of that shape, with Keycloak, Postgres and Smile CDR, lives in [omarhoblos/keycloak-docker](https://github.com/omarhoblos/keycloak-docker/tree/smilecdr-integration). Its setup and quirks are in the [Smile CDR notes](../fhirserverinstructions/smilecdr/fhirservers-smile.md#local-test-bed).

For a public server, point `FHIRENDPOINT_URI` and `ISSUER_URI` at the [SMART App Launcher](https://launch.smarthealthit.org). It accepts any client ID and redirect URI, but it reads its launch settings from a `/sim/` segment in the URL, so copy a launch URL from its page rather than using the bare `/v/r4/fhir` base. `.do/app.yaml` has a working example with the segment decoded.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on port 4200 |
| `npm run check` | Type-check with `svelte-check` |
| `npm run lint` | ESLint and Prettier (`npm run format` fixes formatting) |
| `npm run test:unit` | Vitest unit tests |
| `npx vitest run src/lib/oidc/id-token.test.ts` | One unit test file |
| `npx vitest run -t "falls back"` | Unit tests whose name matches |
| `npm run test:e2e` | Playwright, Chromium and Firefox, against a production build previewed on port 4173 |
| `npx playwright test e2e/flow.spec.ts --project=chromium` | One spec in one browser |
| `npm run build` / `npm run preview` | Production build into `build/`, and serve it |
| `docker compose up -d --build` | Swiss itself in nginx on port 4200, from your working tree |
| `docker build -t swiss-on-fhir:ci . && sh docker/test-entrypoints.sh swiss-on-fhir:ci` | Feed hostile `.env` values to the container's entrypoint scripts |

CI runs lint, type-check, unit tests, the build, the end-to-end tests and the container tests. Run at least the first three before pushing.

The first end-to-end run on a machine needs the browsers: `npx playwright install chromium firefox`. Two things can surprise you:

- **Locally, Playwright reuses a server already on port 4173.** A stale `vite preview` left running there means you test an old build. Stop it, or let Playwright start its own.
- **On macOS 27, Firefox refuses its usual profile folder when launched from a terminal.** `playwright.config.ts` works around it by setting `CFFIXED_USER_HOME`. Leave that in place.

## Finding your way around

Everything is under `src/`. Pages are in `src/routes/`, and everything they use is under `src/lib/`, imported as `$lib/...`.

| Directory | What it owns | Start with |
| --- | --- | --- |
| `routes/` | One folder per page. Pages read stores and call library functions and hold little logic of their own. `+layout.ts` loads the runtime config before anything renders. | `launch/+page.svelte`, `+page.svelte` (Session), `fhir/+page.svelte` |
| `lib/auth/` | The sign-in: orchestration, the in-flight transaction, the established session and where it is stored. | `flow.ts`, `transaction.ts`, `session.svelte.ts` |
| `lib/oidc/` | OAuth and OpenID Connect building blocks, each a plain function: PKCE, the authorization URL, token requests, JWT decoding, ID token verification, the `iss` check, Backend Services keys and assertions, and the claims glossary. | `token.ts`, `id-token.ts`, `claims.ts` |
| `lib/smart/` | SMART specifics: discovery and merging, feature gates, launch context, scope parsing and diffs. | `discovery.ts`, `scopes.ts`, `context.ts` |
| `lib/config/` | Settings: the field table, parsing, validation, the four layers and where overrides are saved. | `fields.ts`, `config.svelte.ts`, `runtime.ts` |
| `lib/diagnostics/` | The checks (one file per group), the runner that orders and skips them, and the store that also holds discovery results. | `checks/discovery.ts`, `runner.ts`, `diagnostics.svelte.ts` |
| `lib/http/` | `probe()`, the exchange record and its redaction, the log, its IndexedDB copy and the drawer's filters. | `probe.ts`, `exchange.ts`, `log.svelte.ts` |
| `lib/fhir/` | The FHIR console's request layer: URLs, paging, OperationOutcome parsing, server names. | `client.ts`, `url.ts` |
| `lib/components/` | Shared UI. `ui/` holds the small primitives (`Card`, `Alert`, `CopyButton`, `Spinner`). | `TokenPanel.svelte`, `ExchangeLogDrawer.svelte`, `ClaimGlossary.svelte` |
| `e2e/` | Playwright specs and their fixtures. | `fixtures.ts`, `flow.spec.ts` |

Outside `src/`: `docker/` and the `Dockerfile` build the image; `config/env.template.json` lists the `.env`-backed settings; `scripts/render-config.mjs` renders them for development; `.github/workflows/` holds CI and the release; `.do/app.yaml` describes the hosted app.

## Conventions

- **Stores are classes.** Each store keeps private `$state` fields and exposes `readonly` `$derived` values and methods, and the module exports one instance (`export const session = new SessionStore()`). There is no `svelte/store`. Copy the shape of `http/log.svelte.ts` for a new one.
- **Libraries take their dependencies as arguments.** A function that makes requests accepts an optional `fetchImpl`, so tests pass a fake instead of mocking globals. Libraries do not import stores; `fhir/client.ts` is the one exception.
- **Comments say why.** The codebase records reasons, alternatives that were rejected, and what the 2.x Angular app did wrong, next to the code they explain. Keep doing that; a comment that only restates the code is noise.
- **Every source file starts with the Apache 2.0 license header.** Copy it from a neighbouring file, in that file type's comment syntax.
- **Text in the UI is plain and specific.** Name things the way the person using Swiss would, say what a button does, and make an error say what went wrong and how to fix it.

## Testing

### Unit tests

Unit tests sit beside the code as `*.test.ts` and run in Vitest's **Node** environment, so there is no DOM. That suits the plain libraries, which is where most logic lives. Anything that depends on a rune store is covered by an end-to-end test instead.

- Pass a fake `fetchImpl` that answers the URLs the code should request and refuses the rest. `oidc/id-token.test.ts` serves a real JWKS this way and signs tokens with `jose`.
- For a diagnostic check, build a `DiagnosticsContext` by hand, as `diagnostics/checks/capabilities.test.ts` does.

### End-to-end tests

Playwright runs every spec in Chromium and Firefox against a production build. `e2e/fixtures.ts` provides:

| Fixture | What it does |
| --- | --- |
| `test` | Playwright's `test`, extended to serve a known `/swiss-env.json` (`RUNTIME_CONFIG`) on every page automatically |
| `stubDiscovery(page)` | Stubs `smart-configuration`, `openid-configuration`, a JWKS, `/metadata` and a token endpoint, at `https://fhir.test` and `https://idp.test` |
| `seedSession(page, overrides)` | Writes a session straight into `sessionStorage`, so a spec can start signed in |
| `diagnosticsFinished(page)` | Waits for a Diagnostics run to end before you assert on what follows it |

Most specs seed a session. `e2e/flow.spec.ts` is the exception: it drives a real authorize, 302, callback and token exchange against a stubbed authorization server that checks PKCE and signs ID tokens with a key it publishes. Add sign-in scenarios there.

Two habits that avoid flaky tests:

- **Open token panels before asserting on their notes.** They are collapsed `<details>` elements.
- **Set the viewport for layout tests.** For phone width, use `test.use({ viewport: { width: 402, height: 874 } })`, as `e2e/responsive.spec.ts` does.

## Common changes

### Add a diagnostic check

1. Write a `Check` in the group's file under `src/lib/diagnostics/checks/` (`environment`, `discovery`, `capabilities`, `cors`, `flow` or `unverifiable`). Give it an `id` such as `disc.something`, a `title`, its `group` and a `run(ctx)` that returns `result({ status, summary, … })` from `diagnostics/types.ts`.
2. Append it to that file's exported array. Its position sets where it appears in the report.
3. If it only makes sense after another check passes, set `dependsOn: ['that.check-id']`; the runner then skips it by name.
4. Make requests through `probe()` with `ctx.fetchImpl`, and return the exchanges in the result so the finding can be verified. For fix-it text, add an entry to `REMEDIATIONS` in `diagnostics/remediation.ts` and pass `remediation('your-id')` in the result.
5. If it changes anything on the server, mark it `mutating: true`, so it only runs when asked.
6. Unit test it with a hand-built context, and extend `e2e/diagnostics.spec.ts` if it changes what the page shows.

### Add a setting

1. Add the key and its type to `AppConfig` in `src/lib/config/types.ts`, and a safe default in `src/lib/config/defaults.ts`.
2. Add one row to `FIELDS` in `src/lib/config/fields.ts`, with:
   - `label` and `help`;
   - `kind`, the input type;
   - `parse`, usually a function from `coerce.ts`;
   - `authCritical`, true if changing it should mark an existing session stale;
   - `emptyMeansUnset`, which decides whether an empty value falls back to the default.

   The Config screen and the runtime parser pick the row up from there.
3. If the setting should come from `.env`, set `envKey` and add it in three more places:
   - `config/env.template.json`, used in development;
   - `docker/docker-entrypoint.d/40-swiss-config.sh`, both in the list of variables it validates and in the JSON it writes, because the container builds the file itself and the two must match;
   - `.env.example`, with a comment, and the README's settings table.
4. Run `sh docker/test-entrypoints.sh` against a fresh image to confirm the container still refuses hostile values.

### Explain a claim or header parameter

Add an entry to `DEFINITIONS` (payload claims) or `HEADER_DEFINITIONS` (JOSE header parameters) in `src/lib/oidc/claims.ts`, with a one-sentence `summary`, an optional `detail` and a `source` linking to the specification section. `claims.test.ts` checks that every entry has an https link and appears in the glossary exactly once. Anything not listed is shown as a custom claim from the server.

### Test a sign-in scenario

Add a case to `e2e/flow.spec.ts`. Its stub authorization server takes options for the behaviour you want to provoke, such as a wrong nonce, a missing or mismatched `iss`, a refresh signed by another key, or a dead `jwks_uri`. Assert on what Swiss shows, and that the session still exists afterwards, since checks report rather than refuse.

### Add a page

Create `src/routes/<name>/+page.svelte` and add it to the `items` list in `src/lib/components/Nav.svelte`. Mark it `needsSession: true` if it is only useful once signed in. The nav shows such pages dimmed rather than hiding them, so people can see they exist. The layout already provides the nav, the exchange log drawer and the shared clock. Check the page at phone width: `e2e/responsive.spec.ts` asserts that no page scrolls sideways at 402px.

### Document a FHIR server

Add a folder under `fhirserverinstructions/` with a Markdown file of the settings that server needs, and link it from "Working with FHIR servers" in the README. Keep server names out of the app's own text and the README's general sections; Swiss aims to stay server-agnostic.

## Rules the code relies on

- **Send every request through `probe()`, and record what it returns.** A bare `fetch` is invisible in the exchange log and gets no diagnosis.
- **Do not re-run discovery from an `$effect`.** Discovery runs when the Launch page opens or when someone asks; a reactive re-run sends requests on every keystroke in the Config editor.
- **Decide where a token goes from the session, not the settings.** Use `session.current.configSnapshot.fhirBaseUrl`, never `config.current.fhirBaseUrl`, which can change under a session.
- **Check discovered endpoints before use.** Anything about to use `diagnostics.endpoints` for a request checks `diagnostics.discoveryStale` first and re-discovers if needed.
- **Guard server-supplied URLs.** Pass any URL from a server or a link through `httpUrl()` (`src/lib/url.ts`) before navigating to it or linking to it.
- **Treat storage and server text as untrusted input.**
  - Validate what is read back from storage (`isPersistedSession`, `isAuthTransaction`).
  - Settings are capped at `MAX_VALUE_LENGTH`.
  - Build objects from outside keys with a `Map` or `Object.fromEntries`, never `out[key] = value`.
- **Report, don't refuse, for servers.** A new check produces a finding. Only a bad deployment input stops anything: the container exits with a `swiss: FATAL:` line naming the variable, never its value.
- **Never let a secret reach disk or a URL.** The client secret stays out of snapshots and the authorization URL. Exchanges are redacted before they are saved to IndexedDB.

## Changelog, commits and pull requests

- **Changelog.** Every user-facing change gets a line in `CHANGELOG.md` under `# Unreleased`, grouped as `## Added`, `## Changed` or `## Fixed`. Write it from the user's side: what they will notice, and why it changed if that is not obvious.
- **Commits.** The subject line describes the effect in the imperative ("Keep the exchange log bar on one line on a phone"). The body explains why, and what was wrong before.
- **Pull requests.** Open them against `main`. CI must pass before merging.

## Releasing

A release is a version tag on `main`:

```bash
npm version 3.2.0 && git push --follow-tags
```

That bumps `package.json`, commits and tags. Move the `# Unreleased` heading in `CHANGELOG.md` to the new version first. The release workflow then:

1. checks that the tag matches `package.json` and sits on `main`;
2. runs the whole CI suite on the tagged commit;
3. builds and pushes the image to Docker Hub as `3.2.0`, `3.2`, `3` and `latest`, for amd64 and arm64;
4. creates the GitHub release with generated notes;
5. redeploys the DigitalOcean app, which follows `3`, and checks that the live site serves its configuration. This step is skipped when the `DO_APP_ID` repository variable is not set.

A pre-release tag such as `v3.2.0-rc.1` publishes only its own image tag and does not deploy.
