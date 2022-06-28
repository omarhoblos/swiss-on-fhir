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
