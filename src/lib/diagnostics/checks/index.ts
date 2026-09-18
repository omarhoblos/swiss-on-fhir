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

import { capabilityChecks } from './capabilities';
import { corsChecks } from './cors';
import { discoveryChecks } from './discovery';
import { environmentChecks } from './environment';
import { unverifiableChecks } from './unverifiable';
import type { Check } from '../types';

/**
 * Check order is the narrative: environment first (no network, instant), then
 * can we reach and parse the discovery documents, then does the server
 * support what we intend to ask for, then can the browser actually talk to
 * the endpoints that matter.
 */
export const ALL_CHECKS: Check[] = [
  ...environmentChecks,
  ...discoveryChecks,
  ...capabilityChecks,
  ...corsChecks,
  ...unverifiableChecks
];

export { capabilityChecks, corsChecks, discoveryChecks, environmentChecks, unverifiableChecks };
