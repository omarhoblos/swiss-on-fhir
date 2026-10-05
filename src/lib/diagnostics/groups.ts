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

import type { CheckGroup } from './types';

/**
 * What each check group is called and what it answers. Shared by the
 * Diagnostics page and the Swiss on FHIR Documentation page, so the two never describe
 * the same group differently.
 */
export const GROUP_LABELS: Record<CheckGroup, { title: string; blurb: string }> = {
  environment: {
    title: 'Environment',
    blurb: 'No network needed. Rules the browser will apply regardless of your server.'
  },
  discovery: {
    title: 'Discovery',
    blurb: 'Can Swiss reach and parse the documents that describe your server?'
  },
  capabilities: {
    title: 'Capabilities',
    blurb: 'Does the server support what Swiss is configured to ask for?'
  },
  cors: {
    title: 'Cross-origin access',
    blurb: 'Can this page actually talk to the endpoints a launch depends on?'
  },
  flow: { title: 'Live flow', blurb: 'Requires an active session.' },
  permissions: { title: 'Permission enforcement', blurb: 'Requires an active session.' }
};
