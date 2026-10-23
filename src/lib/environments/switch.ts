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

import { session } from '#lib/auth/session.svelte.ts';
import { config } from '#lib/config/config.svelte.ts';
import { diagnostics } from '#lib/diagnostics/diagnostics.svelte.ts';

/**
 * Makes another environment active in this tab.
 *
 * Its own module because it reaches every store: the config store cannot
 * import the session or diagnostics, which import it. Order matters: what
 * belongs to the old environment is stopped and forgotten before the
 * configuration changes, so nothing in flight finishes against the new one.
 *
 * Returns false for an unknown id, and changes nothing.
 */
export function switchEnvironment(envId: string): boolean {
  if (envId === config.activeEnvironmentId) return true;
  if (!config.hasEnvironment(envId)) return false;
  diagnostics.abort();
  diagnostics.resetDiscovery();
  config.setActive(envId);
  session.load(envId);
  return true;
}
