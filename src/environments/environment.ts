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

export const environment = {
  fhirEndpointUri: window['env']['fhirEndpointUri'],
  redirectUri: window['env']['redirectUri'],
  issuer: window['env']['issuer'],
  logoutUri: window['env']['logoutUri'],
  clientId: window['env']['clientId'],
  audience: window['env']['audience'],
  scopes:  window['env']['scopes'],
  clientSecret: window['env']['clientSecret'],
  
  // Application Setup
  requireHttps: parseDotEnvBoolean(window['env']['requireHttps']),
  production: false,
  skipIssuerCheck: parseDotEnvBoolean(window['env']['skipIssuerCheck']),
  strictDiscoveryDocumentValidation: parseDotEnvBoolean(window['env']['strictDiscoveryDocumentValidation'])
};

function parseDotEnvBoolean(value: string | boolean) {
  let returnedValue: boolean;
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "true") {
      returnedValue = true;
    }

    if (value.trim().toLowerCase() === "false") {
      returnedValue = false;
    }
  }

  if (typeof value === "boolean") {
    returnedValue = value;
  }
  return returnedValue;
}