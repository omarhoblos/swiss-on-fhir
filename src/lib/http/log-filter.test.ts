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
import type { HttpExchange } from './exchange';
import { filterEntries, matchesQuery, statusCounts, statusLabel, statusTone } from './log-filter';

let next = 0;
function exchange(
  url: string,
  status: number | null,
  overrides: Partial<HttpExchange> = {}
): HttpExchange {
  return {
    id: String(next++),
    label: 'Token exchange',
    startedAt: 0,
    durationMs: 5,
    request: {
      method: 'POST',
      url,
      headers: { Authorization: 'Bearer secret-token-value' },
      body: 'grant_type=authorization_code'
    },
    ...(status === null
      ? {}
      : {
          response: {
            status,
            statusText: status === 200 ? 'OK' : 'Bad Request',
            headers: {},
            body: '{"access_token":"hidden-in-body"}',
            type: 'cors'
          }
        }),
    outcome: status === null ? 'network-or-cors' : status < 400 ? 'ok' : 'http-error',
    redactions: [],
    ...overrides
  };
}

const ok = exchange('https://idp.test/.well-known/openid-configuration', 200, {
  label: 'OpenID configuration'
});
ok.request.method = 'GET';
const badToken = exchange('https://idp.test/token', 400);
const notFound = exchange('https://fhir.test/Patient/nope', 404, { label: 'FHIR request' });
const failed = exchange('https://unreachable.test/metadata', null, { label: 'FHIR metadata' });
const blocked = exchange('http://lan.test/token', null, { outcome: 'blocked-precondition' });
const another200 = exchange('https://fhir.test/metadata', 200, { label: 'FHIR metadata' });
const all = [ok, badToken, notFound, failed, blocked, another200];

describe('statusLabel and statusTone', () => {
  it('files an entry under its status code, or failed / blocked without a response', () => {
    expect(all.map(statusLabel)).toEqual(['200', '400', '404', 'failed', 'blocked', '200']);
  });

  it('colours by class of status', () => {
    expect(['200', '302', '401', '500', 'failed', 'blocked'].map(statusTone)).toEqual([
      'success',
      'info',
      'warning',
      'error',
      'error',
      'error'
    ]);
  });
});

describe('statusCounts', () => {
  it('lists each status once with its count, codes in order, then blocked and failed', () => {
    expect(statusCounts(all)).toEqual([
      { label: '200', count: 2 },
      { label: '400', count: 1 },
      { label: '404', count: 1 },
      { label: 'blocked', count: 1 },
      { label: 'failed', count: 1 }
    ]);
    expect(statusCounts([])).toEqual([]);
  });
});

describe('matchesQuery', () => {
  it('matches the URL, method, label, status and status text, ignoring case', () => {
    expect(matchesQuery(badToken, '/TOKEN')).toBe(true);
    expect(matchesQuery(ok, 'get')).toBe(true);
    expect(matchesQuery(notFound, 'fhir request')).toBe(true);
    expect(matchesQuery(notFound, '404')).toBe(true);
    expect(matchesQuery(badToken, 'bad request')).toBe(true);
    expect(matchesQuery(failed, 'failed')).toBe(true);
    expect(matchesQuery(ok, '  ')).toBe(true);
  });

  it('never searches headers or bodies, where credentials live', () => {
    expect(matchesQuery(badToken, 'secret-token-value')).toBe(false);
    expect(matchesQuery(badToken, 'hidden-in-body')).toBe(false);
    expect(matchesQuery(badToken, 'grant_type')).toBe(false);
  });
});

describe('filterEntries', () => {
  it('drops hidden statuses and non-matching entries, keeping order', () => {
    expect(filterEntries(all, '', new Set())).toEqual(all);
    expect(filterEntries(all, '', new Set(['200', 'failed']))).toEqual([
      badToken,
      notFound,
      blocked
    ]);
    expect(filterEntries(all, 'fhir.test', new Set())).toEqual([notFound, another200]);
    expect(filterEntries(all, 'fhir.test', new Set(['200']))).toEqual([notFound]);
    expect(filterEntries(all, 'nothing-like-this', new Set())).toEqual([]);
  });
});

describe('a cancelled request', () => {
  const cancelled = { outcome: 'aborted' as const, response: undefined };

  it('is filed as cancelled, not failed, and not coloured as an error', () => {
    expect(statusLabel(cancelled)).toBe('cancelled');
    expect(statusTone('cancelled')).toBe('info');
  });

  it('is listed after failed in the status chips', () => {
    const counts = statusCounts([
      cancelled,
      { outcome: 'network-or-cors', response: undefined },
      { outcome: 'blocked-precondition', response: undefined },
      { outcome: 'ok', response: { status: 200 } as never }
    ]);
    expect(counts.map((c) => c.label)).toEqual(['200', 'blocked', 'failed', 'cancelled']);
  });
});
