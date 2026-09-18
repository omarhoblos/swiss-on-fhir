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
  Replaced with Vitest and Playwright, and CI now actually runs them: 2.x ran
  no lint, typecheck, test or app build at all, which is why everything above
  survived in `main`.

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
