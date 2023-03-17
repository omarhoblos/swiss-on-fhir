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
  window["env"]['clientId'] = "swiss";
  window["env"]["fhirEndpointUri"] = "http://localhost:8001";
  window["env"]["redirectUri"] = window.location.origin + '/index.html', // default is http://localhost:4200/index.html
  window["env"]["issuer"] = "http://localhost:9300";
  window["env"]["logoutUri"] = `${window.env.issuer}/logout?cb=none&revoke=token&revoke=token_refresh`;
  window["env"]["clientSecret"] = "secrettest"; // Delete the secret if you're not testing with this
  window["env"]["audience"] = "http://localhost:8001"; // typically the fhir endpoing uri
  window["env"]["scopes"] = "fhirUser offline_access launch/patient openid patient/*.read patient/*.write";
  window["env"]["requireHttps"] = false;
  window['env']['skipIssuerCheck'] = false;
  window['env']['strictDiscoveryDocumentValidation'] = true;
})(this);
