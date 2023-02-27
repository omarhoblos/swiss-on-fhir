/*
 * // Copyright 2021 Omar Hoblos
 * //
 * // Licensed under the Apache License, Version 2.0 (the "License");
 * // you may not use this file except in compliance with the License.
 * // You may obtain a copy of the License at
 * //
 * //     http://www.apache.org/licenses/LICENSE-2.0
 * //
 * // Unless required by applicable law or agreed to in writing, software
 * // distributed under the License is distributed on an "AS IS" BASIS,
 * // WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * // See the License for the specific language governing permissions and
 * // limitations under the License.
 */

(function(window) {
  window["env"] = window["env"] || {};

  window["env"]["fhirEndpointUri"] = "${FHIRENDPOINT_URI}";
  window["env"]["redirectUri"] = "${REDIRECT_URI}", // default is http://localhost:4200/index.html
  window["env"]["issuer"] = "${ISSUER_URI}";
  window["env"]["logoutUri"] = "${LOGOUT_URI}";
  window["env"]["clientId"] = "${CLIENT_ID}";
  window["env"]["clientSecret"] = "${CLIENT_SECRET}"; // Delete the secret if you're not testing with this
  window["env"]["audience"] = "${AUDIENCE}";
  window["env"]["scopes"] = "${SCOPES}";
  window["env"]["requireHttps"] = "${ENABLE_HTTPS}";
  window['env']['skipIssuerCheck'] = "${SKIP_ISSUER_CHECK}";
  window['env']['strictDiscoveryDocumentValidation'] = "${STRICT_DISCOVERY_DOCUMENT_VALIDATION}";
  window['env']['patient'] = "${PATIENT}";

})(this);
