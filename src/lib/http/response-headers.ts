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

import type { HttpExchange } from './exchange';

/**
 * The response headers the FHIR console can show, and what it cannot.
 *
 * A page reads a cross-origin response's headers only as far as CORS allows:
 * the safelist plus whatever the server names in Access-Control-Expose-Headers.
 * The rest reach the browser, and its devtools show them, but never the page,
 * so Swiss shows what it was given and says the rest may exist.
 */

export interface ResponseHeaderView {
  /** Name and value, sorted by name. */
  headers: [name: string, value: string][];
  /** The response was cross-origin, so the browser may have hidden headers. */
  mayHide: boolean;
  /** Headers that matter for this status and were not readable: not sent, or not exposed. */
  unreadable: string[];
}

export function responseHeaderView(
  response: HttpExchange['response'] | undefined
): ResponseHeaderView | null {
  // A no-cors probe's response is opaque: nothing in it is readable.
  if (!response || response.type === 'opaque') return null;
  return {
    headers: Object.entries(response.headers).sort(([a], [b]) => a.localeCompare(b)),
    // `basic` is same-origin, where every header but Set-Cookie is readable.
    mayHide: response.type === 'cors',
    unreadable: response.unreadableHeaders ?? []
  };
}
