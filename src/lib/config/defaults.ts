/*
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
*/

import type { AppConfig } from './types';

/**
 * Baked defaults: the bottom layer, used when neither the runtime file nor a
 * live override supplies a value.
 *
 * `clientSecret` is empty on purpose. Swiss 2.x shipped a working
 * `secrettest` secret in both .env and assets/env.js, and the README told
 * users to register it.
 */
export const DEFAULTS: AppConfig = {
  fhirBaseUrl: 'http://localhost:8000',
  authIssuer: 'http://localhost:9200',
  clientId: 'swiss',
  clientSecret: '',
  scopes: 'openid fhirUser offline_access launch/patient patient/*.read patient/*.write',

  clientAuthMethod: 'none',
  audMode: 'exact',
  scopeSyntax: 'auto',
  tokenStorage: 'session',
  redactSecrets: true
};
