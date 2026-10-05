# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The human-facing developer documentation is the app's own **How Swiss works** page, `/how-it-works` (`src/routes/how-it-works/+page.svelte`, diagrams in `src/lib/components/how-it-works/`, styled by the `.dg` rules in `app.css`): how the parts fit together, then setup, commands, source map, testing, recipes, rules and releasing. Its Diagnostics list is generated from `ALL_CHECKS`; the diagrams and prose are hand-written, so keep them accurate when you change what they describe. Keep the page free of links to other sites, of product names, and of private test infrastructure.

## What Swiss is

A browser-only developer tool for testing FHIR servers and OIDC/SMART authorization servers: it runs the SMART App Launch flow itself, shows every request and token, and reports conformance problems instead of hiding them. Three policies run through the whole codebase and should shape any change:

- **Report, don't refuse.** A bad nonce, an unverifiable ID token, a mismatched `iss`: these become findings next to the token, never a blocked sign-in. "This server returns the wrong nonce" is the output the tool exists to produce (`src/lib/oidc/id-token.ts` header comment).
- **Advertise, don't block.** Servers under-report their capabilities constantly, so a missing entry in a discovery document only produces a warning; only an explicit contradiction disables a control, and even then behind an override (`src/lib/smart/types.ts`).
- **Every parameter is previewable and every exchange is logged.** Swiss builds the authorize URL itself so it can be shown before navigating, and all HTTP goes through `probe()` into the exchange log. Do not introduce fetches that bypass `probe()`.

## Commands

Node 22+. Port 4200 is fixed on purpose: every existing client registration uses `http://localhost:4200/callback`.

```bash
cp .env.example .env     # defaults match the local test bed (see below)
npm install
npm run dev              # http://localhost:4200; predev renders .env into static/swiss-env.json
npm run check            # svelte-check
npm run lint             # eslint + prettier --check   (npm run format to fix)
npm run test:unit        # vitest, node environment, src/**/*.test.ts
npx vitest run src/lib/oidc/id-token.test.ts        # one unit file
npx vitest run -t "falls back"                       # one test by name
npm run test:e2e         # playwright: builds, previews on 4173, chromium + firefox
npx playwright test e2e/flow.spec.ts --project=chromium   # one spec, one engine
docker compose up -d --build   # Swiss itself in nginx on http://localhost:4200
docker build -t swiss-on-fhir:ci . && sh docker/test-entrypoints.sh swiss-on-fhir:ci   # hostile .env values against the entrypoint scripts
```

First e2e run on a machine needs `npx playwright install chromium firefox`. On macOS 27 Firefox refuses `~/Library/Application Support/Firefox` when launched from a terminal; `playwright.config.ts` works around it with `CFFIXED_USER_HOME`, so leave that in place.

## Architecture

SvelteKit with `adapter-static`, `ssr = false`, every route falling back to `index.html` (nginx `try_files` in `docker/nginx.conf`). State lives in Svelte 5 rune classes exported as singletons (`session`, `config`, `diagnostics`, `exchangeLog`), not `svelte/store`. The only runtime dependency is `jose`.

### Configuration layering

`.env` → `scripts/render-config.mjs` in development, or `docker/docker-entrypoint.d/40-swiss-config.sh` in the container (it writes the JSON itself with `printf`, keyed to match `config/env.template.json`) → `static/swiss-env.json` → `src/lib/config` merges it with baked `DEFAULTS` and per-field in-app overrides in `localStorage`. The Config screen tags each value with its source. The client secret is stored in its own storage slot and is deliberately absent from `ConfigSnapshot`, so transactions and sessions never carry it (`src/lib/config/merge.ts`). A production build runs `render-config --defaults-only` so no `.env` is ever baked into an image.

### The auth flow (`src/lib/auth`, `src/lib/oidc`, `src/lib/smart`)

- `oidc/*` are pure protocol primitives with injectable `fetchImpl`: PKCE (`pkce.ts`), authorize URL (`authorize.ts`), token endpoint requests and the three client-auth encodings (`token.ts`), unverified JWT decoding for display (`jwt.ts`), ID token verification via jose against the discovered JWKS (`id-token.ts`), RFC 9207 `iss` check (`iss-parameter.ts`), and Backend Services keys + `private_key_jwt` assertion (`keys.ts`, `assertion.ts`).
- `auth/flow.ts` is the single orchestrator: `beginAuthorization` (discovery if needed → PKCE, state, nonce → save an `AuthTransaction` → `location.assign`) and `completeCallback` (match `state` → exchange → non-fatal checks → `session.establish`). Everything the callback needs is snapshotted into the transaction at launch time (redirect URI, endpoints, config, advertised `jwks_uri`s), so a config edit mid-flow cannot cause an inexplicable `invalid_grant`.
- `auth/transaction.ts` keeps in-flight launches in `sessionStorage` under `swiss.tx.v1.<state>` with a status machine that stops a reloaded callback re-sending a single-use code. `auth/session.svelte.ts` holds the established session (`swiss.session.v1`, storage mode configurable) and does manual refresh/revoke; auto-refresh is deliberately off because the moment of failure is the information.
- `smart/discovery.ts` fetches `smart-configuration` (FHIR base, falling back to host root), `openid-configuration` and the CapabilityStatement OAuth-URIs extension, then merges by precedence **smart-configuration > openid-configuration > capability-statement** (the only three sources: an EHR launch's `iss` changes the FHIR base through the config launch layer instead, and there are no per-endpoint overrides), recording conflicts and dropping anything that is not http(s). `advertisedValues()` exposes every candidate for a key when a caller can retry (the ID token check uses it for `jwks_uri`). `smart/context.ts` resolves `patient`/`encounter`/`fhirUser` from the token response first, then the ID token, then the access token JWT. `smart/scopes.ts` parses both SMART v1 and v2 syntax and diffs requested vs granted.
- `httpUrl()` in `src/lib/url.ts` is the guard used wherever a discovered string becomes a navigation or link. Keep using it.
- **The bearer token follows the session, not the configuration.** `session.current.configSnapshot.fhirBaseUrl` is the base a token was issued for; the FHIR console resolves against it and `fhirRequest` only attaches the token to that origin (`tokenBase`). `config.current.fhirBaseUrl` can change under a session, by an edit or by an EHR launch's `iss`, so never gate a token on it.
- **Discovery runs when the Launch page opens**, and only then without being asked: opening the page is the user's action. It is skipped while `diagnostics.discovered` says what is held matches the configured base and issuer, and `discover()` shares an in-flight run with any caller asking for the same ones. Do not add an `$effect` that re-discovers on config edits; that refetches on every keystroke.
- **An EHR launch is discovered from its own server only.** When `iss` names a server other than the configured FHIR base, `diagnostics.discover()` probes the issuer that server's `smart-configuration` declares and never falls back to `config.authIssuer`; with no authorization endpoint the launch does not start. The fallback still applies to standalone launches and to an `iss` equal to the configured base.
- **An EHR launch's `iss` is a layer owned by the launch page.** `launch/+page.svelte` applies it while the URL carries `iss` and clears it, with the endpoints discovered under it (`diagnostics.resetDiscovery()`), when the URL loses it or the page is left. `diagnostics.discoveryStale` says the held endpoints were discovered for another base or issuer; anything about to use `diagnostics.endpoints` for a request checks it and re-discovers.
- **Storage and server text are input.** `isPersistedSession` / `isAuthTransaction` gate what is read back; settings are capped at `MAX_VALUE_LENGTH` in `coerceString`; objects built from outside keys use `Object.fromEntries` or a `Map`, never `out[key] = value`.

### Diagnostics (`src/lib/diagnostics`)

`Check` objects (`checks/*.ts`) run in a dependency-ordered `runner.ts` with a `DiagnosticsContext` that deliberately exposes only a few session facts, not the session object. The `flow` group (`checks/flow.ts`) needs a session: `DiagnosticsSession` carries the access token and `tokenBase` for it, and those checks follow the FHIR console's rule, reading only from `tokenBase`'s origin and never sending the token elsewhere, and redact the exchanges they return unless the user turned redaction off. Each result carries the raw `HttpExchange`s so a finding can be verified. Check order is the narrative: environment → discovery → capabilities → CORS → unverifiable. New checks are appended to the group's array in the corresponding `checks/*.ts`.

### HTTP layer (`src/lib/http`)

`probe()` wraps fetch, classifies the outcome (`network-or-cors`, `bad-content-type`, `aborted`, …) and produces an `HttpExchange`. Every request has a timeout; a caller's `signal` is combined with it (`anySignal`), never substituted for it, and a request stopped through that signal is `aborted`, with no diagnosis and no follow-up request. Anything that can be stopped by the user passes its signal all the way down: Diagnostics hands `ctx.signal` to every check and to discovery, and a stopped discovery or check commits nothing. `exchange.ts` redacts secrets and tokens (including nested keys) before anything is persisted to the IndexedDB log. Only redacted entries are ever written.

### Tests

- Unit tests sit beside the code. Anything touching the rune singletons is covered by e2e instead, since vitest runs in the node environment.
- `e2e/fixtures.ts`: `stubDiscovery` stubs the discovery documents and a token endpoint at `https://idp.test`; `seedSession` writes a session straight into storage so most specs need no login. `e2e/flow.spec.ts` is the exception: it drives a real authorize → 302 → callback → exchange against a stubbed IdP that verifies PKCE and signs an ID token with a key served at its JWKS URI. Add flow-level scenarios there.
- Token panels are collapsed `<details>`; open them before asserting on their notes.

## Local test bed

Manual testing uses a local stack of the shape `.env.example` expects: a SMART authorization server on **9200** (federated to an identity provider), its FHIR server on **8000**, and Swiss registered as public client `swiss`. Keep its specifics (repository, product names, credentials) out of this repository. The client must list `launch` and `launch/patient` as separate scopes: Swiss's defaults carry both and `adjustScopesForFlavor` (`src/lib/smart/scopes.ts`) sends `launch` on an EHR launch and `launch/patient` on a standalone one, never both.

## Decisions log

- **2026-09 · Deployment input is refused, not repaired.** "Report, don't refuse" is about servers under test. A control character or an over-long value in the container's `.env` is an operator error, so `40-swiss-config.sh` and `41-swiss-security-headers.sh` exit with a `swiss: FATAL:` line naming the variable (never the value) instead of altering it, and `scripts/render-config.mjs` does the same for `npm run dev`.

- **2026-09 · Auth stays hand-rolled, on `jose`.** An evaluation of replacing the 3.0 auth core with a library (oidc-client-ts, fhirclient, @badgateway/oauth2-client, oauth4webapi/openid-client) found that only panva's oauth4webapi family has independent conformance evidence (OpenID-certified RP profiles), and that oidc-client-ts and fhirclient verify *less* than Swiss does (neither checks the ID token signature). Chosen path: keep the custom request-building and never-block layer, close the concrete gaps first (done in PR #863: ID token re-checked on refresh, algorithm allow-list and required claims, RFC 9207, jwks_uri fallback, first end-to-end flow test). **Parked:** adopting oauth4webapi as the validation engine behind a thin adapter that converts its typed errors into findings; a "strict / conforming client" toggle; running the OpenID Foundation RP conformance suite against Swiss.
- **2026-09 · Hosting: DigitalOcean App Platform pulling from Docker Hub.** Docker Hub stays the only registry; `.do/app.yaml` runs the `3` tag in `tor`. App Platform only auto-deploys from DigitalOcean's own registry, so `release.yml`'s `deploy` job calls `doctl apps create-deployment` after `publish`, opt-in on the `DO_APP_ID` repository variable and skipped for pre-releases. The spec is a create-once template: live environment variables are edited in the control panel, and the workflow never re-applies the spec.
- **2026-09 · The Docker Hub overview is generated from the README at release.** `release.yml` calls `dockerhub-readme.yml` after `publish` (skipped for pre-releases); it can also be run by hand, defaulting to the latest release. `scripts/dockerhub-readme.mjs` replaces Mermaid blocks, which Docker Hub does not render, with links to GitHub and pins relative links to the release tag. A unit test runs it over the real README, so a README change Docker Hub cannot take fails CI. `DOCKER_HUB_ACCESS_TOKEN` must have Read, Write & Delete scope.
- **2026-09 · Ports.** 9200 is the SMART authorization server and 8000 the FHIR server in the local stack. Swiss stays on 4200 (dev) and 4173 (e2e preview).
- **2026-09 · Test data.** `bundle.md` is the canonical dataset (patient `patient-a`); loading it into a test server is handled outside this repo.
