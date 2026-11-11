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

# 3.2.0

This release introduces the long awaited feature of multiple environment support! Along with a slew of other fixes, this introduces some breaking changes from the previous release. Read on to find out more about what's new in 3.2!

## Upgrading

- 3.1.x settings, client secret, session and Backend Services key are migrated to the `Default` environment the first time 3.2 loads.
- A 3.1.x build does not read what 3.2 stores, so export your environments first if you may go back.

## Added

- You can now keep several environments, each a complete setup of FHIR server, authorization server, sign-in client, authorization type and testing options. 
  - You can also create, copy, rename and delete them on the Config screen, and switch between them from the menu in the navigation bar.
- Each environment holds one session per launch type, so a Backend Services token no longer replaces a standalone session. The Session screen switches between Standalone, EHR launch and Backend Services.
- All environments export as one JSON file. Import previews each environment before anything is applied, and takes a `.json` or `.env` file by picker, drop or paste. A 3.1 export still imports.
- A Backend Services private key can be imported as a JWK or a PKCS#8 PEM (RSA of 2048 bits or more, or EC P-384). 
  - Swiss will not allow exporting of private keys.
- A deployment can ship environments to every visitor by mounting a file at `/etc/swiss-environments/environments.json`. They appear beside Default and are read-only; edits made in the browser sit on top and can be reset.
- The FHIR API screen now supports multiple tabs. Each tab keeps its own request and response and works in one environment, and choosing a tab switches to its environment. A draft persists in the tab, even after reloading.
- Standalone and EHR sign-ins can authenticate with `private_key_jwt`, so a confidential asymmetric client can be tested.
- Diagnostics has a Backend Services capability check, and each check now says which launch types it applies to.
- Each card on the Config screen has a Reset All button that resets only that card's settings.
- Config warns about `system/` scopes in the sign-in scopes and about user scopes in the Backend Services scopes.

## Changed

- The Config screen shows the sign-in client or the Backend Services client, whichever the default launch type uses.
- Download JSON and Download as .env replace the copy buttons on the Config screen. The `.env` leaves out the client secret unless you include it.
- The Warnings card on the Config screen is now titled "Heads Up on your Setup", and says Swiss will still run.
- The exchange log shows only this browser tab's requests, with a filter by environment.
- Two tabs sharing a session refresh it once: the second takes up the new tokens instead of sending a refresh token that was already used. A duplicated tab warns before sending one.
- An EHR launch that names another environment's FHIR server offers to switch to that environment.
- The RFC 9207 check passes when the server does not advertise `iss`, which is optional. Swiss still checks any `iss` that arrives on sign-in.
- A missing `authorization_endpoint` fails Diagnostics only when the server offers a user launch.
- Help text is shorter on every screen and on the documentation page.
- Each related file on the documentation page links to its source in the GitHub repo.
- Previously, The FHIR API screen would not clearly explain why the user would get a 401 or 403. It now compares the request with the granted scopes and names a scope that would cover it, or says the server refused a permission the token has. It also reads the `WWW-Authenticate` header when the browser can see it.

## Fixed

- An ID token with no `kid` now verifies when several keys in the key set match. Swiss used to give up with "multiple matching keys found"; it now tries each key.
- A session kept in local storage is no longer lost on reload.
- Changing settings during sign-in no longer sends another configuration's client secret. The callback uses the secret the launch started with, and reports it if the secret has changed since.
- A stored session with missing context no longer crashes the Session screen.
- An unexpected error on the callback no longer leaves the Launch screen saying an authorization flow is in progress.
- Long code in Diagnostics wraps on a phone instead of scrolling the page sideways.

## Container

- `/swiss-env.json` and `/swiss-environments.json` are served with their own strict Content-Security-Policy.
- Every response carries `Cross-Origin-Resource-Policy: same-origin`, so another site cannot load Swiss's files as its own scripts or images. Showing Swiss in a frame is unaffected.
- The image's build stage has been bumped from Node 22 to 26, and the served image from nginx 1.29 to 1.31.

## Development

- `npm run test:conformance` runs Swiss through the OpenID Foundation Basic RP plan and Inferno's SMART App Launch client suite. It runs locally only.
- `npm run security:baseline` scans the container build with OWASP ZAP.
- `npm run dashboard` starts the dev server and opens it in a browser.

## Dependencies

- `jose`, Swiss's only runtime dependency, 6.2.12 → 6.2.17.
- `minimatch` is forced to 11 for a denial-of-service advisory. It is a development dependency, used by ESLint.
- Patch and minor updates to Svelte, SvelteKit, Vite, Tailwind and the test and lint tools, and to four GitHub Actions workflows.

# 3.1.7

Clearer ID token findings, the key set request in the exchange log, and no false issuer mismatch for an issuer that ends in a slash.

## Changed

- An ID token finding now names the claim that failed. A wrong `iss` or `aud`, a missing `sub`, `exp` or `iat`, or an expired token used to be reported as a failure of the key set, although the signature had held. The finding now says the signature verified and shows what the server sent beside what was expected.
- An `alg: none` token is reported as unsigned, in Swiss's words instead of the JOSE library's.

## Fixed

- Diagnostics no longer fails "OpenID configuration and issuer match" for an issuer that ends in `/`. Swiss strips a trailing slash from the configured authorization server and then compared the two byte for byte, so such a server always failed and the "Use … as the authorization server" button could not fix it. A different host or path still fails.
- The ID token's key set request now appears in the exchange log like every other request.
- A key set the browser could not read used to be reported only as "Failed to fetch". The finding now gives the cause: a missing `Access-Control-Allow-Origin`, an unreachable host, an HTTP error or a body that is not JSON.
- A token signed with an algorithm Swiss does not accept no longer fetches a key set at all.

## Dependencies

- `jose`, Swiss's only runtime dependency, is unchanged at 6.2.12.
- Patch updates to Svelte, SvelteKit, Vite and the test and lint tools, and to two GitHub Actions workflows.

# 3.1.6

A wrong diagnosis for token requests that fail on CORS, and a spinner on the FHIR API screen.

## Changed

- The FHIR API screen shows a spinner beside the Response title while a request is sent, as the Diagnostics and Session screens do. It replaces the loading bar inside the card.

## Fixed

- A token endpoint with no CORS set up is now reported as a missing `Access-Control-Allow-Origin`. Swiss used to blame a failing preflight, which browsers never send for a token request. This affected the code exchange, refresh, revoke, the Backend Services token request and the Diagnostics token endpoint check.
- A `PUT`, `PATCH` or `DELETE` with no unusual headers is preflighted for its method, and is now reported that way.
- A preflight diagnosis names only what caused the preflight, such as `Authorization`, `Content-Type: application/fhir+json` or the `DELETE` method, and says which of `Access-Control-Allow-Headers` and `Access-Control-Allow-Methods` to fix.

## Dependencies

- `jose`, Swiss's only runtime dependency, is unchanged at 6.2.12.
- SvelteKit 2 → 3 and its static adapter 3 → 4. Nothing changes in the running app, but building Swiss from source now needs Node 22.17 or later.

# 3.1.5

A header editor with suggestions, JSON and XML on the FHIR API screen, a security review of every page against the OWASP Top 10, and the session's status in the bottom bar.

## Added

- The header name box on the FHIR API screen lists the headers FHIR requests use, each with a line on what it does. Custom headers can still be typed.
- The header value box follows the header chosen. It suggests values for `Accept`, `Content-Type`, `Prefer` and `Cache-Control`, offers a date picker for `If-Modified-Since` and a Generate button for `X-Request-Id`, and gives `Authorization` a choice of Basic, Bearer or anything else. Basic takes a username and password and encodes them.
- The request body on the FHIR API screen has a JSON / XML switch, and malformed XML is named before anything is sent.
- The response has the same switch. Switching asks for the last GET again in that format, and never sends a POST, PUT, PATCH or DELETE a second time.
- An XML response is shown as a collapsible tree with the same search, copy, Bundle summary, Next page link and OperationOutcome issues as JSON. The screen says when a server answers XML with JSON, or with XML that is not FHIR.
- A metadata quick query asks the FHIR server for its CapabilityStatement.
- The Config screen has a read-only card for the `frame-ancestors` the server sends, set from `FRAME_ANCESTORS` in the container. It says what the value means for an EHR that shows apps inside its own screen.
- The bottom bar shows "Active session" or "Session expired" on every page, linking to the Session page.

## Changed

- The response opens fully expanded. Collapse all is still there for a large Bundle.
- Header fields are the size of the request bar, and the header lists open as soon as a field is focused.
- Download JSON and Download Markdown in the exchange log are now one Download menu.

## Security

These come from a review of every page against the OWASP Top 10 (2025).

- An `Authorization` or API-key header you add on the FHIR API screen is sent only to the FHIR server the session belongs to, as the access token is, unless you allow another. A server could otherwise put another host in a Bundle's next link and collect it on the next click.
- Swiss warns before credentials go over plain HTTP to anything but this machine.
- Copy as .env on the Config screen now follows "Include client secret", as Copy as JSON does.
- Copy as curl in Diagnostics is redacted like the exchange log.
- Refresh and Revoke leave out a client secret that was set for a different authorization server or client than the session's, and the Session page says so.
- When a launch link has replaced the configured FHIR server, Backend Services signs an assertion for that server's token endpoint only after you tick to allow it.
- A malformed ID token or token response no longer loses the sign-in. It used to crash the callback after the code had been spent; it is now reported on the Session page.
- An unexpected error on the callback is shown instead of hidden.
- A response nested too deeply to check for tokens is no longer stored as it came, and a form-encoded token response is now redacted too.
- The Docker Hub overview workflow accepts a release tag only in the form `vX.Y.Z`, and passes it to its scripts as data.

## Container

- With `FRAME_ANCESTORS` unset, the container now allows `self https://launch.smarthealthit.org`, so the SMART test launcher can show a deployed Swiss in a frame without any setup. An explicit value still replaces the default, and existing deployments that set it keep what they set.
- Every response now carries `Strict-Transport-Security` (a year, without `includeSubDomains`), a `Permissions-Policy` refusing camera, microphone, location, payment, USB and screen capture, and `Cross-Origin-Opener-Policy: same-origin`.
- An EHR that opens Swiss in a popup can no longer script that window. Framing is unaffected.

## Dependencies

- `jose`, Swiss's only runtime dependency, is unchanged at 6.2.12.
- `source-map-js` 1.2.1 → 1.2.2, a build-time dependency, for a denial-of-service advisory.

# 3.1.4

A documentation page inside the app, search and Expand all on the FHIR API screen, and a navigation bar that stays in view.

## Added

- A "Swiss on FHIR Documentation" page is linked from the footer. It shows how Swiss's parts fit together, with one diagram per mechanism, then covers setup, commands, the source map, testing, recipes for common changes and releasing. It can be searched, and it replaces the Markdown files that were in `docs/`.
- The documentation page's list of Diagnostics checks is generated from the checks themselves, so it cannot go out of date.
- Every page has a button that scrolls back to the top.
- The FHIR API screen has an Expand all button. When expanded, the response runs the full length of the page instead of scrolling inside its own box. A new response starts at the default depth again.
- A search box above the response on the FHIR API screen searches its keys and values. Matches are marked, Enter and Shift+Enter step through them, and the search is kept when the next response arrives.

## Changed

- The main navigation stays at the top of the screen while you scroll.
- The Response card's header, with the status, the URL sent and the search box, stays in view while the response scrolls.
- The Config screen's message about a leftover `${VAR}` placeholder used to blame an envsubst step Swiss no longer has. It now says `swiss-env.json` was never rendered from `.env`, and to check that the container's entrypoint is not overridden and the file is not replaced by a mounted one.

## Fixed

- Revoking tokens no longer fails on servers that answer revocation in plain text. Swiss asked for `application/json` only, and such a server refused with 406 Not Acceptable.
- The Session page used to say "Revocation requested" whatever the server answered. It now says when the server did not accept a revocation, with each token's status and any OAuth error.

## Container

- The image runs on nginx 1.29, up from 1.27.

## Dependencies

`jose`, Swiss's only runtime dependency, is unchanged at 6.2.12. Svelte and `devalue` are compiled into the app; the rest are build, lint and test tools.

- `svelte` 5.57.0 → 5.57.1
- `@sveltejs/vite-plugin-svelte` 7.3.0 → 7.3.1
- `devalue` 5.9.2 → 5.9.4, a dependency of SvelteKit
- `vite` 8.3.0 → 8.3.1
- `vitest` 5.0.1 → 5.0.2
- `eslint` 10.10.0 → 10.11.0
- `typescript-eslint` 8.70.0 → 8.71.0
- `prettier` 3.9.6 → 3.9.9
- `@types/node` 26.6.0 → 26.6.3

# 3.1.3

A Diagnostics check for `fhirUser`, the server's name on the FHIR API screen, and a pass over contrast and layout in both themes and on small screens.

## Added

- A new Diagnostics check looks up the `fhirUser` claim on the FHIR server, as the session. It fails when the server has no such resource, since a claim can be well formed and signed and still point at a record that does not exist.
- The same check warns when the session may not read the resource, when the claim sits on another server, when it came from an unverified ID token or from the access token, when its type is not one SMART allows, and when a patient or `RelatedPerson` user does not match the patient in context.
- The check reads only from the FHIR server the token was issued for, and is skipped without a session.
- The Request card on the FHIR API screen names the server it is talking to, using the software name and version from the server's CapabilityStatement, or its `title`.
- When you send a request to a full URL on another server, the card names that server instead. Its `/metadata` is read without your token.

## Changed

- The Bundle summary counts `Bundle.entry` and reads "Bundle returned with 2 total entries". It used to compare that with `Bundle.total`, which leaves out resources added by `_include` or `_revinclude`, and so could read "Bundle with 2 of 1 entries".
- Colour contrast meets WCAG 2.2 AA in both themes. This changes the text on purple buttons in the dark theme, the edges of inputs, dropdowns and outlined buttons, the dark theme's error colour, and the light theme's teal and placeholder text.
- Diagnostics advice for a CORS failure and for a missing end-session endpoint no longer describes one particular server's settings. Setup notes for specific servers stay in the repository's [`fhirserverinstructions`](fhirserverinstructions) folder.

## Fixed

- Dropdown arrows sit clear of the edge in every browser. Chrome drew the arrow almost against the right border, so dropdowns now draw their own. High-contrast modes keep the system arrow.
- On a phone, a card's buttons now sit under its title instead of sharing a row with it.
- Only the list scrolls in the glossary, so the search box and the chosen definition stay in view.
- The Config screen said "depricated".

## Documentation

- The Smile CDR instructions have their own folder, [`fhirserverinstructions/smilecdr`](fhirserverinstructions/smilecdr/fhirservers-smile.md).
- The sample federated sign-in script now reads Keycloak's multi-valued `roles` claim, checks for claims that may be missing, and sets the patient launch context only when there is a patient.
- The README is rewritten, with two diagrams and a link to the deployed app.

# 3.1.2

Fixes from testing the Diagnostics and Launch screens against servers that do not answer, and a way to run Swiss on DigitalOcean App Platform.

## Added

- [`.do/app.yaml`](.do/app.yaml) runs the published Docker Hub image on DigitalOcean App Platform, behind its HTTPS and following the `3` tag. It is a template for creating the app once; the steps are in the comments at the top of the file.

## Fixed

- Stop on the Diagnostics screen now takes effect at once, and nothing more is sent. It used to do nothing while the discovery documents were being read, which could take 44 seconds against a server that never answers.
- A check interrupted by Stop is left out instead of shown as a failure, and the page says the run was stopped. The next run reads the discovery documents again.
- Every request now has a time limit. A request that could be cancelled used to lose its 15-second timeout, so a FHIR API request to a server that never answered waited for as long as the tab stayed open.
- The follow-up request Swiss sends after a network failure, to tell a CORS problem from a connectivity one, now times out too, and says when it could not tell the two apart.
- A request stopped with Cancel on the FHIR API screen, or Stop on the Diagnostics screen, is logged as `cancelled`. It used to be reported as a network or CORS failure, and Swiss sent the server another request to investigate.
- On the FHIR API screen, a request that was cancelled or replaced by a newer one can no longer overwrite the newer one's result.
- An alert inside a card keeps a gap from the checkbox, list or alert above it.
- With no authorization endpoint discovered, Start launch and Preview the URL no longer add a second alert repeating the warning above them.
- Leaving the Launch screen stops a discovery it started, which could otherwise finish afterwards and put back the endpoints it had just cleared.

## CI

- A release now redeploys the DigitalOcean app and checks that the live app serves a rendered `/swiss-env.json`. This runs only when the repository variable `DO_APP_ID` is set, and not for pre-releases.
- CodeQL moves to 4.38.2 in both of its steps. Dependabot now groups the two steps into one pull request, because neither passes when updated alone.

# 3.1.1

Search and filters in the exchange log, a glossary for token claims, and a header and log bar that fit on a phone.

## Added

- A search box narrows the exchange log by URL, method, status or what made the request. Headers and bodies are not searched, since that is where credentials live.
- The exchange log has a filter for each HTTP status present, plus `failed` and `blocked`, with a count beside each. Search and filters narrow the view only: downloads still contain every entry.
- Hover over a claim or header parameter in the access token or ID token panel to read what it means, or click it for the definition and a link to its specification.
- The glossary covers the claims from OpenID Connect Core, the JWT and OAuth token RFCs and SMART App Launch, and every JOSE header parameter. Anything else is marked as custom to your server.
- A Glossary button on the Tokens card opens the full list, with a search box.

## Fixed

- The exchange log bar stays on one line on a phone. Its Download and Clear buttons used to wrap onto extra rows over the bottom of the page; on narrow screens they now sit at the top of the opened log.
- The header fits on a phone. Below tablet width the pages sit behind a menu button, where every page used to scroll sideways.

# 3.1.0

A review of what Swiss does with input: what is typed into it, what arrives on a link, what a server sends back, what it reads from its own storage, and what is in the `.env` a container starts from. It is a minor version because three of the changes affect deployments that were working; they are listed first.

## Changed

- The container refuses to start when `FHIRENDPOINT_URI`, `ISSUER_URI`, `CLIENT_ID`, `CLIENT_SECRET` or `SCOPES` holds a tab, a line break or another control character, or is over 4096 characters. It used to remove the character silently, which could turn a stray keystroke into a different client secret.
- The same applies to a `FRAME_ANCESTORS` with a line break in it or over 2048 characters.
- A refused value stops startup with a line in `docker logs` naming the variable, never the value. Under Docker Compose this shows as a restart loop until `.env` is fixed, and `npm run dev` fails the same way.
- With a session, the FHIR API screen uses the FHIR base the token was issued for, and says so when it differs from the configured one. After an EHR launch from another server, requests used to go to the configured server carrying the launch server's token.
- The default scopes now include `launch` alongside `launch/patient`: `openid fhirUser offline_access launch launch/patient patient/*.read patient/*.write`. Swiss sends `launch` on an EHR launch and `launch/patient` on a standalone one, and reports the change on the Launch screen.
- Add `launch` to the client on your authorization server as its own entry. A client that lists only `launch/patient` is refused an EHR launch with `invalid_scope`. A deployment that sets `SCOPES` itself is unaffected.
- Settings are limited to 4096 characters in `.env`, on the Config screen and on import, and `swiss-env.json` to 64 KiB.

## Added

- "Preview the URL" on the Launch screen now shows a real launch, with a copy button. Opening the URL in the same tab within ten minutes completes the launch, where the preview used to fail at the callback with "no transaction".
- A previewed launch still cannot complete in another tab or browser, and the screen says so.
- The Launch screen reads the discovery documents when it opens, so an unreachable server is reported before a launch is started. Nothing is fetched again while the FHIR base and authorization server are unchanged.
- Selecting "EHR launch" shows Swiss's launch URL and redirect URI, each with a copy button, to give to the EHR.

## Fixed

- A link to `/launch?iss=…` no longer overrides the FHIR base for as long as the tab stays open. Anyone who followed such a link while signed in and then used the FHIR API screen sent their bearer token to the server the link named. The override now ends when the Launch page is left.
- An EHR launch whose server could not be read is no longer sent to the configured authorization server. The launch token and the client secret went to a server the launch never named. The launch now uses only what its own server publishes, and does not start without an authorization endpoint.
- The endpoints discovered for a launch link are no longer reused by the next launch. A standalone launch or a Backend Services token request started afterwards went to the linked server.
- A `fhirUser` claim of `https://` no longer crashes the Session screen.
- A stored session, launch or log entry that Swiss did not write, or that is truncated, is now dropped. It used to be read as it was and could take the app to the error page on every load.
- A FHIR query or a `Bundle.link[next]` with a `javascript:` or `data:` scheme is refused. The "open this URL" action in Diagnostics checks the scheme too.
- A request header that cannot be sent, such as a name with a space in it, used to be reported as a likely CORS problem. The header editor now says which row is invalid and leaves it out.
- A token response field, discovery extension, header or response body key named `__proto__` or `constructor` is now displayed like any other.
- A response body containing a line of backticks no longer breaks out of its code block in the exported Diagnostics report and exchange log. A status text containing markup no longer does the same to the summary line.
- When `swiss-env.json` fails partway through being read, Swiss runs on defaults with Config reachable instead of showing the error page.
- A `swiss-env.json` with hundreds of unknown keys lists twenty and counts the rest.
- A scope listed twice is reported once on the Launch page.

## Container

- `FRAME_ANCESTORS` is checked for line breaks and length before anything else. The earlier check ran a line at a time and so never saw a line break.
- A value can no longer forge a line in the startup log, since a line break in one is refused first.

## CI

- `docker/test-entrypoints.sh` runs the entrypoint scripts inside the built image against values written to break them: quotes, backslashes, `%` and `$`, tabs, line breaks, over-long values, and attempts to add an nginx directive through `FRAME_ANCESTORS`. It runs in CI before the container is started.

# 3.0.2

Follow-up to the 3.0.1 review of the sign-in code. Still report-only: every new check produces a finding next to the token, never a refusal.

## Fixed

- A refresh that returned a new ID token kept the verdict from sign-in, so the ID token panel could say "verified" about a token nobody had checked. The refreshed token is now checked the same way (signature, `iss`, `aud`, `exp`, and that `sub` is unchanged, per OpenID Connect Core 12.2), the panel says whether the verdict is from sign-in or the last refresh, and a refresh that returns no ID token keeps showing the sign-in token with its own verdict instead of "No ID token was issued".
- ID token verification now accepts only asymmetric signing algorithms and requires `sub`, `exp` and `iat` to be present. A token without an expiry previously verified.
- When the discovery documents disagree about `jwks_uri` and the preferred one does not answer, the ID token is now checked against the next advertised key set instead of being reported as unverifiable, and the fallback is itself reported.

## Added

- RFC 9207 `iss` on the authorization response. The callback compares it to the discovered issuer and reports a mismatch (the "mix-up" attack), or its absence when the server advertised `authorization_response_iss_parameter_supported`. Diagnostics gained "Authorization responses name their issuer", which says whether the server advertises it at all.
- Unit tests for the PKCE, authorize-URL and token-endpoint modules, and the first end-to-end test that drives a real authorize → callback → token exchange against a stubbed identity provider, including a signed ID token and PKCE verification at the token endpoint.

# 3.0.1

A security release, following a full review of the 3.0.0 code. Nothing here changes what Swiss does for a correctly behaving server; the fixes are about what a hostile or broken one could make it do.

## Fixed

- A discovery document could supply a `javascript:` URL as any endpoint, and Swiss would navigate to it (`authorization_endpoint`) or link to it (`end_session_endpoint`). A crafted `/launch?iss=…` link was enough to reach this. Every discovered endpoint must now be an http(s) URL; anything else is dropped and reported by the "Discovery documents agree" check.
- The ID token is now verified at sign-in — signature against the discovered JWKS, `iss`, `aud`, `exp` and `nonce` — and the result is shown on the ID token panel. The `nonce` was previously generated and sent but never compared, and the token was never verified although a comment said it was. Problems are reported as warnings, not refusals: a diagnostic tool should show the bad token.
- An OAuth error arriving on `/callback` is only treated as the server's verdict when its `state` matches a launch this tab started; anything else is shown but labelled. `error_uri` is linked only when it is http(s).
- `iss` from an EHR launch must be an http(s) URL, and the Launch page warns when a configured client secret would be sent to the token endpoint that server advertises.
- The bearer token is attached only to requests to the FHIR base's origin. A typed absolute URL or a `Bundle.link[next]` pointing elsewhere gets it only after a per-page opt-in, and the console says when it was withheld.
- The exchange log redacts the `token` field of revocation requests, credential-looking custom headers (`X-Api-Key` and the like), and token keys nested anywhere in a response body. Previously a token whose revocation failed was persisted still valid.
- "Copy as curl" shell-quotes every value, not just the body. The "Use … as the authorization server" fix-it validates its value. The `$everything` quick query encodes the patient id.

## Container

- **The container now listens on port 8080, not 80.** nginx and the startup scripts run as the unprivileged `nginx` user, which cannot bind 80. `docker run … -p 4200:80` becomes `-p 127.0.0.1:4200:8080`; `compose.yaml` is updated. Only the host side of the mapping can collide with other containers, so a Keycloak on `8080:8080` is unaffected.
- The nginx access log no longer records query strings, which on `/callback` and `/launch` held the authorization code, `state`, `iss` and `launch`.
- `server_tokens` is off; a Content-Security-Policy with `script-src 'self'` is sent (the theme script moved from inline to `static/theme.js`); Compose binds `127.0.0.1` by default, with `SWISS_BIND` to widen it.
- The runtime config is rendered with a JSON escaper instead of `envsubst`, so a quote in a value no longer breaks it. A bare `*` in `FRAME_ANCESTORS` warns at startup.

## CI

- GitHub Actions are pinned to commit SHAs. The check that a build bakes in no configuration now builds under a poisoned environment so it can fail. A release tag must point at a commit on `main`. CodeQL scans the app again, not only the workflow files.

# 3.0.0

This release marks a major milestone for Swiss. For a while, the application was stuck in dependency hell, along with Angular 15 being too far behind the latest Angular releases that design patterns & functions no longer upgrade cleanly. With this release, the app has been replaced with SvelteKit and TypeScript, and the parts of Swiss that were not actually working have not only been fixed, but also comes with a host of new features! As this has now switched to Sveltekit & Typescript, Vite is now the default build tool, improving build times significantly. 

With this, let's go over the various changes:

## Improved configuration for Standalone & Docker deployments 

Between Version 2 and this release, the Dockerfile lost the `envsubst` step that
rendered `.env` into the app's runtime config. A container built from `main`
ignored `--env-file` entirely and served hardcoded `localhost` values plus the
committed `secrettest` client secret, which made the README's central promise
("any changes made in `.env` will show up in the application") false.

That is fixed, and guarded: config rendering now happens in the nginx
entrypoint hook rather than in `CMD`, so it cannot be dropped by a future
edit, and CI runs a container with a known `.env` and asserts the values
actually reach the app. Four other Docker defects went with it — the build
output landed one directory deeper than nginx served, the lockfile was
ignored, there was no `.dockerignore`, and the build and cleanup scripts
disagreed about the container name so cleanup always failed.

## Improved SMART on FHIR support

Version 2 had SMART support, but was lacking a few features (such as support for EHR Launch)
that was desparately needed. Along with some missing fields and support for other launches
being restrained by the old OIDC library used in the Angular version, this release brings a 
host of improvements, including:

* SMART discovery across `smart-configuration`, `openid-configuration`, and
  the SMART 1.0 CapabilityStatement extension, with provenance on every
  endpoint and conflicts reported rather than silently resolved.
* Three launch modes: standalone, EHR launch (`?iss=&launch=`), and backend
  services (client credentials with a JWT assertion signed by a
  non-extractable browser key).
* Explicit PKCE S256, with the verifier and challenge visible.
* `aud` sent, with variants for servers that disagree about its exact form.
* Launch context read from the token response first, the ID token second, and
  an access-token claim only as a clearly-labelled last resort.
* SMART 1.0 and 2.0 scope syntax, with a granted-vs-requested diff that
  separates a real permission reduction from a syntax rewrite.

## New: a diagnostics screen

One piece of feedback heard from other testers is the need for additional checks
throughout the OIDC process. Errors with the setup would be hard to catch before 
being sent to the server, along with fairly opaque errors when they did display.
Roughly 27 checks across environment, discovery, capabilities and CORS, with
the raw request and response for each and actionable remediation. Now most 
misconfigurations are visible before a launch is attempted. Checks that a browser 
genuinely cannot perform are listed explicitly with the reason, rather than omitted.
Logging can now be downloaded as JSON & Markdown.

## New: live configuration editing

Every setting can be changed in the app without a rebuild or restart, layered
over the deployment's `.env`. Each field shows whether its value came from a
default, from `.env`, or from a live edit, with a per-field reset. This was on
the 2.x roadmap for a while, and combined with the better error handling, makes
testing configurations far less of a hassle for developers.

## New: a full FHIR REST console

All five HTTP methods with a request-body editor, replacing the GET-only
component. Version 2 requested `patient/*.write` scope and then had no way to
exercise it. Write verbs sit behind a per-request confirmation.

## Security fixes

While Swiss was never intended to be deployed to a production server beyond initial
testing, with Version 3, security designs have been improved significantly, allowing
testers to safely deploy Swiss in production compared to Version 2. As always, 
security testing requires more eyes than mine, so any feedback & improvements are 
always welcomed. 

* **The client secret was being sent on the authorization request.** Version 2
  put it in `customParamsAuthRequest`, which is not a valid authorize
  parameter, leaking it into URLs, browser history, referrers and the IdP's
  access logs.
* **A working client secret was committed** in both `.env` and
  `src/assets/env.js`, it was originally allowed to testers could add secrets and 
  view how their servers would react. This held back logging and a few other features.
  With Version 3, `.env` is now untracked, `.env.example` ships with an empty secret,
  and secrets are not persisted to disk unless you explicitly opt in.
* **Logout called `sessionStorage.clear()`**, wiping unrelated data belonging
  to anything else on the origin. It now removes only its own keys.
* **Copied tokens were logged to the console.** They are not any more.
* The Bootstrap CDN `<script>` and `<link>` tags are gone, thus ensuring all libraries & 
  dependencies are self-contained.

## Bug Fixes

* The token expiry banner was frozen. It captured the current time once at
  component construction and never updated; it now ticks.
* `OperationOutcome` parsing returned only `issue[0]`, discarding the rest.
* The "unknown error" CORS hint mutated its own input and only ran once, so it
  appeared on the wrong error or not at all.
* Removing a middle header row re-bound the surviving inputs to the wrong
  values, because rows were keyed by index.
* The FHIR query parser treated any query starting with a digit as an absolute
  URL, and any query starting with the letters `http` as absolute — so
  `httpbin/Patient` was sent verbatim.
* The loading indicator was cleared by three separate overlapping timeouts.
* `parseDotEnvBoolean` returned `undefined` for anything that was not exactly
  `"true"` or `"false"`, so a typo silently became `false`, and it could not
  tell an unsubstituted `${VAR}` placeholder from a real value.
* The light theme had black card surfaces, an invisible focus ring, and an
  error colour that failed contrast on white.
* The accordion chevron never moved, because the open and closed states used
  the same SVG.

## Breaking changes

* **`REDIRECT_URI`, `LOGOUT_URI`, `ENABLE_HTTPS` and
  `STRICT_DISCOVERY_DOCUMENT_VALIDATION` are removed.** All four were plumbed
  from `.env` into the app in 2.x and then read by nothing. Leaving them in
  your `.env` is harmless — Swiss recognises them and notes they can be
  deleted. See the README for what replaced each. These are values carried over
  from the defunct OIDC library version that Angular 15 supported.
* **The redirect URI is now derived as `<origin>/callback`.** Callbacks
  arriving at `/`, `/index.html`, or any path carrying `code` are still
  handled, so existing client registrations keep working.
* **The runtime config file moved** from `assets/env.js` to `/swiss-env.json`
  and is now JSON. If you were hand-editing `env.js` for a non-Docker
  deployment, use `.env` and `scripts/render-config.mjs` instead. (The old
  path also collided with the new `/config` route.)
* **Node 22 or newer** is required to build.
* **Sub-path hosting is not supported.** Serve Swiss at the origin root.

## Removed

* Protractor and Karma, both end-of-life, along with seven unit tests that
  were untouched CLI scaffold — one of which asserted a `title` property and a
  `.content span` that never existed in this app, so it could not pass.
  Replaced with Vitest and Playwright. 
* Configurations have been cleaned up for better readability and avoiding redundant configuration options.

# 2.0.2
This release includes the following:

* Various package updates to address vulnerabilities found by Synk

# 2.0.1
This release includes the following:
* Fix for issue [276](https://github.com/omarhoblos/swiss-on-fhir/issues/276): Will now clear session storage on logout.

# 2.0.0

Lots of changes in this release! Thank you to everyone for your feedback in the past few months, this has helped shaped what will go into this & future releases.

This release includes the following:

* Replaced the original OAuth with the `angular-auth-oidc-client`. To the end user & function of this app, this should not show any noticable difference. This has a number of benefits, including:
    * More robust logging in the console log
    * Support for multiple configurations at once (not yet enabled in Swiss!)
    * Support for more custom configurations
* Fixed typos in the FHIR component page
* Re-named components for better consistency
* Updated patient test data with meta tags & identifier
* Upgraded from TSLint to ESLint
    * This is less relevant for the deployed versions of the app, but should lead to better code quality down the line for other contributors
* Removed 32-bit ARM support for Docker images
    * Swiss can still be run on 32-bit machines when building from source

## Breaking Change(s)

* Removed `strictDiscoveryDocumentValidation` as the option no longer applies with the current library
    * If you still have this option in your configuration file, this will not affect anything. The application has been updated to simply ignore the option if it's present.

I suspect for a majority of users this should not affect them. This might introduce some breaks in environments where URLs are not consistent across different auth APIs from your IDP. If this is an issue, please reach out, file a ticket, and we can work to resolve it. 

Of note - despite replacing the OAuth library used, configurations from previous deployments should remain backwards compatible. 

# 1.4.2

This release includes the following:

* Added JSON Viewer for viewing FHIR Data.

Library used for json view [ngx-json-viewer](https://www.npmjs.com/package/ngx-json-viewer)

# 1.4.1

This release includes the following:

* Adding routing to Swiss on FHIR
* Added new home component
    * Moved majority of app component content to home component
    * App routing module added to app component
    * modified app component to reroute in `toggleClass` method
* Added auth guard to redirect unlogged in users to the home page

# 1.4

Re-aligning our version numbers so it's easier to manage later. But that's not the fun part you're looking for! 

This release includes the following:

* A light mode option has been added
* An option to persist user theme selection has been added
* Icons updated to use Font Awesome 5
* Improved visibility for text & icons
* Improved error handling & error message output in Swiss
* A form has been added to the `fhirdata` component
    * Users can now add their own custom query to send to the server
    * Users can now add custom headers
        * Headers are by default gone after each refresh, so the option to persist them is available
        * An option to always add the Bearer token to your calls is also available in the form
* Various package updates

Of note with this release:

* If Swiss is instructed to save headers, all header selections will be saved in local storage & persist, even if the user has logged out. Toggling the persist option off will reset stored headers.

# 1.2

Some small changes in this release, nothing ground breaking but definitely helpful for those who are testing their FHIR responses. 

This release includes the following:

* There are now two buttons for searching on the fhirdata page - one for the regular `_revinclude` search, and one for `$everything`
* The fhirdata component now supports `$everything` when querying using the Patient ID

# 1.0

The public release! Honestly, I was not expecting to publish this publicly initially, so a lot of code had to be refactored before this release. Overall a net positive, far happier with this release, and lays the groundwork for some neat stuff down the line.

This release includes the following:

* Dark Mode is now the default theme of the application, taking inspiration from the [Material Design docs](https://material.io/design/color/dark-theme.html#usage)
* Error messages are now in a separate component, allowing easy drop-in support for any component that needs to display an `OperationOutcome` without having to re-create the HTML & logic from scratch
* A "Copy" button was added to the Access Token & ID Token sections of the Your Tokens page, no need to highlight the whole text & fiddle around
* The Allergy Data view has been dropped, replaced with a "FHIR Data" view, that shows the raw response from the server. While I initially intended for that view to give ops & developers a chance to see what FHIR data might look like in the app, it made it harder to figure out if the payload contained all the data you requested
* The URL for the Logout button is now a configurable option in the `.env.js` & `.env` files
* `strictDiscoveryDocumentValidation` is now a configurable option in the `.env.js` & `.env` files
* Cleaned up unused functions & dependencies in the app & fhirdata components
* A new loading animation has been added in the fhirdata component
* A refresh button has been added in the fhirdata component, allowing users to quickly fetch data again from the server without having to reload the page
* Vendor specific dependencies have been removed
* A models.ts file has been introduced, currently only has the errorObject model, but will expanded with other definitions as the app grows in feature set

# 0.9.0

This is a private release that was in testing. While no logs were originally kept for each version made, I'll take this opportunity to write up all the changes that led up to the 0.9.0 release.

* Support for Docker deployments
* Hot-swappable config files in run time (currently only supports changing configs on build time)
* Proper User Revocation Endpoint support for Smile CDR
* Refresh tokens are now supported
* Updated error messages & error handling
* 2 new Docker scripts, one for deploying the application, one for cleaning up & deleting the app
* Updated README with instructions on how to setup your environment to support user revocation correctly, docker instructions,  and other minor tweaks
