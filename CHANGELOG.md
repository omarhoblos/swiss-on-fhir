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

# 3.1.0

A review of what Swiss does with input: what is typed into it, what arrives on a link, what a server sends back, what it reads from its own storage, and what is in the `.env` a container starts from. A minor version rather than a patch, because three things change for deployments that were working; they are listed first.

## Changed

- **The container refuses to start on a value it would have had to alter.** A tab, a line break or any other control character in `FHIRENDPOINT_URI`, `ISSUER_URI`, `CLIENT_ID`, `CLIENT_SECRET` or `SCOPES` used to be removed silently, which turned a stray keystroke into a different client secret and an authentication failure that named nothing. It now stops startup with a line in `docker logs` naming the variable, never the value. The same goes for a value over 4096 characters, and for a `FRAME_ANCESTORS` with a line break in it or over 2048 characters. Under Docker Compose this shows up as a restart loop until `.env` is fixed. `npm run dev` fails the same way.
- **With a session, the FHIR API screen uses the FHIR base the token was issued for**, not the configured one, and says so when the two differ. After an EHR launch whose `iss` was not the configured server, requests used to go to the configured server carrying the launch server's token. They now go to the launch server. The configured one is still reachable by typing an absolute URL, without the token unless you allow it.
- **The default scopes now include `launch`**, alongside `launch/patient`: `openid fhirUser offline_access launch launch/patient patient/*.read patient/*.write`. One client registration then serves both kinds of launch. Swiss sends the one that applies and reports the change on the Launch screen: `launch/patient` becomes `launch` on an EHR launch, as before, and `launch` is now left out of a standalone launch, which has no launch token to bind it to. "Send my scopes verbatim" is available for both. **Add `launch` to the client on your authorization server**, as its own entry: a client that lists only `launch/patient` is refused an EHR launch with `invalid_scope`. A deployment that sets `SCOPES` itself is unaffected.
- **Settings are limited to 4096 characters**, in `.env`, on the Config screen and on import, and `swiss-env.json` to 64 KiB.

## Added

- **"Preview the URL" on the launch screen now shows a real launch, with a copy button.** The preview used to be built from a PKCE verifier that was thrown away, so the URL looked usable, reached the server's consent screen, and then failed at the callback with "no transaction". The launch is now saved when it is previewed, so opening the URL in the same tab within ten minutes completes it. It still cannot complete in another tab or browser, because the verifier is kept in the tab's session storage, and the screen says so. Each preview replaces the one before.

- The Launch screen reads the discovery documents when it opens, so the request summary is filled in and an unreachable server is reported before a launch is started, not after. Nothing is fetched again while what is held still matches the configured FHIR base and authorization server, and a launch started while discovery is running shares it rather than fetching twice.
- Selecting "EHR launch" shows what the EHR has to be given: Swiss's launch URL and its redirect URI, for wherever it is running, each with a copy button.

## Fixed

- A link to `/launch?iss=…` overrode the FHIR base for as long as the tab stayed open, not for the launch. Anyone who followed such a link while signed in and then used the FHIR API screen sent their bearer token to the server the link named. The override now ends when the launch page is left or loses its `iss`, the FHIR API screen takes its base from the session, and the launch page says when a launch names a different server than the session.
- An EHR launch whose server could not be read was sent to the configured authorization server instead. Discovery fell back to the configured issuer whenever the launch's `iss` published no issuer of its own, so the launch token, the `aud` and, at the exchange, the client secret went to a server the launch never named. This is how a launch from one EHR came back rejected by another's scope rules. An EHR launch that names a server other than the configured FHIR base now uses only what that server publishes, or the issuer it declares; when it publishes no authorization endpoint the launch does not start, and the Launch screen says which server was not asked and why.
- The endpoints discovered for a launch link were kept and reused by the next launch, so a standalone launch or a Backend Services token request started afterwards went to the linked server, with the configured client secret if there was one. Discovery now remembers which FHIR base and issuer it ran for, and runs again when they have changed.
- A `fhirUser` claim of `https://` crashed the Session screen, and kept crashing it on every reload because the session is stored.
- A stored session, launch or log entry that was not what Swiss had written, whether truncated, hand-edited or left by an older build, was used as it was and could take the app to the error page on every load. Stored state is now checked and dropped if it does not have the right shape.
- A FHIR query or a `Bundle.link[next]` carrying its own scheme (`javascript:`, `data:`) resolved to exactly that instead of being resolved against the base. Both are now refused, and the "open this URL" action in Diagnostics checks the scheme itself rather than relying on where the URL came from.
- A request header that cannot be sent, such as a name with a space in it, made `fetch` fail before anything reached the network, and Swiss reported that as a likely CORS problem on the server. The header editor now says which row is invalid and leaves it out.
- A token response field, discovery extension, header or response body key named `__proto__` or `constructor` was dropped from the display, or matched an inherited member.
- A response body containing a line of backticks closed the code block it was shown in, in the exported Diagnostics report and exchange log, so the rest of the body was read as part of the report wherever it was pasted. A status text containing markup did the same to the summary line.
- `swiss-env.json` failing partway through being read showed the error page instead of running on defaults with Config reachable. A file with hundreds of unknown keys produced a note for each; it now lists twenty and counts the rest.
- A scope listed twice was reported twice on the launch page.

## Container

- `FRAME_ANCESTORS` is checked for line breaks and length before anything else. The character check ran a line at a time and so never saw a line break; the value was only safe because of what happened to it afterwards.
- The startup log can no longer be given a forged line through a value, since a line break in one is refused first.

## CI

- `docker/test-entrypoints.sh` runs the entrypoint scripts inside the built image against values written to break them: quotes, backslashes, `%` and `$`, tabs, line breaks, over-long values, and attempts to add an nginx directive through `FRAME_ANCESTORS`. It runs in CI before the container is started, and locally against any image.

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
