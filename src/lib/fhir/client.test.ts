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

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The request layer is tested without a network or the log store: what
// matters here is which headers it decides to hand to the probe.
const probe = vi.hoisted(() => vi.fn());
vi.mock('$lib/http/probe', () => ({ probe }));
vi.mock('$lib/http/log.svelte', () => ({ exchangeLog: { record: vi.fn() } }));

import { describeResult, fhirRequest, tokenBelongsOn } from './client';

const BASE = 'https://fhir.example/baseR4';

describe('tokenBelongsOn', () => {
  it('attaches the token to the FHIR base origin', () => {
    expect(tokenBelongsOn(new URL('https://fhir.example/baseR4/Patient'), BASE, false)).toBe(true);
    // Same origin, different path: a Bundle.link[next] on the same server.
    expect(tokenBelongsOn(new URL('https://fhir.example/other?page=2'), BASE, false)).toBe(true);
  });

  it('withholds it from any other origin by default', () => {
    for (const url of [
      'https://evil.example/Patient',
      'http://fhir.example/baseR4/Patient', // scheme differs
      'https://fhir.example:8443/baseR4' // port differs
    ]) {
      expect(tokenBelongsOn(new URL(url), BASE, false), url).toBe(false);
    }
  });

  it('sends it anywhere once the user opts in', () => {
    expect(tokenBelongsOn(new URL('https://evil.example/Patient'), BASE, true)).toBe(true);
  });

  it('withholds it when the base itself is not a URL', () => {
    expect(tokenBelongsOn(new URL('https://fhir.example/Patient'), '', false)).toBe(false);
  });
});

describe('fhirRequest token gate', () => {
  beforeEach(() => {
    probe.mockReset();
    probe.mockResolvedValue({
      exchange: { response: { status: 200 }, durationMs: 1 },
      json: { resourceType: 'Patient', id: 'p' },
      text: '{}'
    });
  });

  const sentHeaders = () =>
    (probe.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;

  it('attaches the token when the request goes to the base', async () => {
    const result = await fhirRequest({
      method: 'GET',
      query: 'Patient/p',
      base: BASE,
      accessToken: 'access-1',
      authorize: true
    });

    expect(sentHeaders().Authorization).toBe('Bearer access-1');
    expect(result.tokenWithheld).toBeUndefined();
  });

  it('withholds it when the base is not the one the token was issued for', async () => {
    // The shape of the launch-link attack: the base was swapped under a
    // session that belongs to another server.
    const result = await fhirRequest({
      method: 'GET',
      query: 'Patient/p',
      base: 'https://evil.example/fhir',
      tokenBase: BASE,
      accessToken: 'access-1',
      authorize: true
    });

    expect(probe.mock.calls[0]?.[0]).toBe('https://evil.example/fhir/Patient/p');
    expect(sentHeaders().Authorization).toBeUndefined();
    expect(JSON.stringify(sentHeaders())).not.toContain('access-1');
    expect(result.tokenWithheld).toBe('https://evil.example');
  });

  it('sends it there once the user opts in', async () => {
    const result = await fhirRequest({
      method: 'GET',
      query: 'Patient/p',
      base: 'https://evil.example/fhir',
      tokenBase: BASE,
      accessToken: 'access-1',
      authorize: true,
      allowCrossOriginToken: true
    });

    expect(sentHeaders().Authorization).toBe('Bearer access-1');
    expect(result.tokenWithheld).toBeUndefined();
  });

  it('drops a next link that is not http(s)', async () => {
    probe.mockResolvedValue({
      exchange: { response: { status: 200 }, durationMs: 1 },
      json: { resourceType: 'Bundle', link: [{ relation: 'next', url: 'javascript:alert(1)' }] },
      text: '{}'
    });

    const result = await fhirRequest({
      method: 'GET',
      query: 'Patient',
      base: BASE,
      authorize: false
    });

    expect(result.nextPage).toBeNull();
  });
});

describe('describeResult', () => {
  it('counts every entry in the Bundle, including resources pulled in by _revinclude', () => {
    // Bundle.total counts only matches, so it is 1 here while entry holds 2.
    // Comparing the two used to read "Bundle with 2 of 1 entries".
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [
        { resource: { resourceType: 'Patient', id: 'patient-a' }, search: { mode: 'match' } },
        {
          resource: { resourceType: 'ExplanationOfBenefit', id: 'eob-1' },
          search: { mode: 'include' }
        }
      ]
    };
    expect(describeResult(bundle)).toBe('Bundle returned with 2 total entries');
  });

  it('ignores Bundle.total, even on a paged search', () => {
    const page = {
      resourceType: 'Bundle',
      total: 57,
      entry: Array.from({ length: 20 }, (_, i) => ({
        resource: { resourceType: 'Patient', id: `p${i}` }
      }))
    };
    expect(describeResult(page)).toBe('Bundle returned with 20 total entries');
  });

  it('says entry for one and entries otherwise, including none', () => {
    expect(describeResult({ resourceType: 'Bundle', entry: [{}] })).toBe(
      'Bundle returned with 1 total entry'
    );
    expect(describeResult({ resourceType: 'Bundle', total: 0 })).toBe(
      'Bundle returned with 0 total entries'
    );
    expect(describeResult({ resourceType: 'Bundle', entry: 'not a list' })).toBe(
      'Bundle returned with 0 total entries'
    );
  });

  it('still describes a single resource by type and id', () => {
    expect(describeResult({ resourceType: 'Patient', id: 'patient-a' })).toBe('Patient/patient-a');
    expect(describeResult('text')).toBeNull();
  });
});
