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

import { describe, expect, it } from 'vitest';
import { responseHeaderView } from './response-headers';

const response = (type: string, headers: Record<string, string>, unreadableHeaders?: string[]) => ({
  status: 200,
  statusText: 'OK',
  headers,
  type,
  unreadableHeaders
});

describe('responseHeaderView', () => {
  it('lists the readable headers sorted by name', () => {
    const view = responseHeaderView(
      response('cors', { 'x-request-id': 'abc', 'content-type': 'application/fhir+json' })
    );
    expect(view?.headers).toEqual([
      ['content-type', 'application/fhir+json'],
      ['x-request-id', 'abc']
    ]);
  });

  it('says a cross-origin response may hide headers, and a same-origin one does not', () => {
    expect(responseHeaderView(response('cors', {}))?.mayHide).toBe(true);
    expect(responseHeaderView(response('basic', {}))?.mayHide).toBe(false);
  });

  it('carries the headers that mattered and could not be read', () => {
    const view = responseHeaderView(response('cors', {}, ['location', 'www-authenticate']));
    expect(view?.unreadable).toEqual(['location', 'www-authenticate']);
    expect(responseHeaderView(response('cors', {}))?.unreadable).toEqual([]);
  });

  it('shows nothing when there is no response, or an opaque one', () => {
    expect(responseHeaderView(undefined)).toBeNull();
    expect(responseHeaderView(response('opaque', {}))).toBeNull();
  });
});
