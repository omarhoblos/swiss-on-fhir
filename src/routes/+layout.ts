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

import { loadRuntimeConfig } from '$lib/config/runtime';
import { config } from '$lib/config/config.svelte';

/**
 * Static SPA. `ssr: false` is what makes this a client-only app; the
 * adapter-static `fallback: 'index.html'` in svelte.config.js is what lets
 * non-prerenderable routes exist at all.
 *
 * `prerender: false` is deliberate: a prerendered page would bake build-time
 * state into the output, which is exactly the "config is baked into the
 * build" problem the runtime config system exists to avoid.
 */
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';

export async function load({ fetch }) {
  // Blocking on this is the point: the auth and FHIR layers must never see a
  // half-initialised config. Components then read the `config` store rather
  // than this load's return value -- threading it through `data` would turn
  // every live edit into a navigation-invalidation problem.
  const result = await loadRuntimeConfig(fetch);
  config.hydrate(result);
  return {};
}
