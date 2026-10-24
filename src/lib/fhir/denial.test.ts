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
import type { HttpExchange } from '#lib/http/exchange.ts';
import { explainDenial, parseBearerChallenge, requestNeed, type DenialInput } from './denial';

const BASE = 'https://fhir.test/r4';

function exchange(
  status: number,
  path: string,
  headers: Record<string, string> = {},
  unreadableHeaders?: string[]
): HttpExchange {
  return {
    id: '1',
    label: 'GET',
    startedAt: 0,
    durationMs: 1,
    request: { method: 'GET', url: `${BASE}/${path}`, headers: {} },
    response: { status, statusText: '', headers, type: 'cors', unreadableHeaders },
    outcome: 'ok',
    redactions: []
  };
}

function input(overrides: Partial<DenialInput> = {}): DenialInput {
  return {
    exchange: exchange(403, 'Patient'),
    method: 'GET',
    base: BASE,
    credential: 'session-token',
    granted: { value: 'system/Observation.rs', source: 'token-response' },
    launchType: 'backend-services',
    patient: null,
    expired: false,
    ...overrides
  };
}

const text = (hint: ReturnType<typeof explainDenial>) => hint?.points.join('\n') ?? '';

describe('requestNeed', () => {
  it.each([
    ['GET', 'Patient', 'Patient', 's'],
    ['GET', 'Patient?name=x', 'Patient', 's'],
    ['POST', 'Patient', 'Patient', 'c'],
    ['POST', 'Patient/_search', 'Patient', 's'],
    ['GET', 'Patient/123', 'Patient', 'r'],
    ['PUT', 'Patient/123', 'Patient', 'u'],
    ['PATCH', 'Patient/123', 'Patient', 'u'],
    ['DELETE', 'Patient/123', 'Patient', 'd'],
    ['DELETE', 'Patient?identifier=x', 'Patient', 'd'],
    ['GET', 'Patient/123/_history/2', 'Patient', 'r'],
    ['GET', 'Patient/123/Observation', 'Observation', 's']
  ] as const)('%s %s needs %s.%s', (method, path, resource, op) => {
    expect(requestNeed(method, `${BASE}/${path}`, BASE)).toEqual({
      kind: 'resource',
      resource,
      op
    });
  });

  it.each([
    ['GET', 'metadata'],
    ['GET', 'Patient/123/$everything'],
    ['GET', '$export'],
    ['POST', '']
  ] as const)('%s %s names no resource scope', (method, path) => {
    expect(requestNeed(method, `${BASE}/${path}`, BASE).kind).toBe('unknown');
  });

  it('does not read a path outside the FHIR base', () => {
    expect(requestNeed('GET', 'https://fhir.test/other/Patient', BASE).kind).toBe('unknown');
    expect(requestNeed('GET', 'https://elsewhere.test/r4/Patient', BASE).kind).toBe('unknown');
    // A base that is a prefix of another path segment is not the same base.
    expect(requestNeed('GET', 'https://fhir.test/r4b/Patient', BASE).kind).toBe('unknown');
  });

  it('works with a base that has a trailing slash', () => {
    expect(requestNeed('GET', `${BASE}/Patient/1`, `${BASE}/`)).toMatchObject({
      resource: 'Patient',
      op: 'r'
    });
  });
});

describe('parseBearerChallenge', () => {
  it('reads quoted and bare parameters', () => {
    expect(
      parseBearerChallenge(
        'Bearer realm="fhir", error="insufficient_scope", error_description="Needs a, b", scope=system/Patient.r'
      )
    ).toEqual({
      realm: 'fhir',
      error: 'insufficient_scope',
      errorDescription: 'Needs a, b',
      scope: 'system/Patient.r'
    });
  });

  it('finds Bearer among several challenges, in any case', () => {
    expect(parseBearerChallenge('Basic realm="x", bearer error="invalid_token"')).toEqual({
      realm: undefined,
      error: 'invalid_token',
      errorDescription: undefined,
      scope: undefined
    });
  });

  it('stops at the next challenge', () => {
    expect(parseBearerChallenge('Bearer realm="a", Basic realm="b"')?.realm).toBe('a');
  });

  it('reads escaped quotes', () => {
    expect(parseBearerChallenge('Bearer error_description="say \\"no\\""')?.errorDescription).toBe(
      'say "no"'
    );
  });

  it('returns null without a Bearer challenge', () => {
    expect(parseBearerChallenge('Basic realm="x"')).toBeNull();
    expect(parseBearerChallenge('')).toBeNull();
  });

  it('takes a bare Bearer', () => {
    expect(parseBearerChallenge('Bearer')).toEqual({
      realm: undefined,
      error: undefined,
      errorDescription: undefined,
      scope: undefined
    });
  });
});

describe('explainDenial', () => {
  it('says nothing for other statuses', () => {
    expect(explainDenial(input({ exchange: exchange(200, 'Patient') }))).toBeNull();
    expect(explainDenial(input({ exchange: exchange(404, 'Patient') }))).toBeNull();
  });

  it('names the missing scope when no granted scope covers the request', () => {
    const hint = explainDenial(input());
    expect(hint?.title).toMatch(/refused/);
    expect(text(hint)).toContain('search on `Patient`, and no granted scope allows that');
    expect(text(hint)).toContain('`system/Patient.s`');
    expect(text(hint)).toContain('`system/Patient.read` in SMART v1');
    expect(text(hint)).toContain('Granted: `system/Observation.rs`');
  });

  it('says when a scope names the resource but not the operation', () => {
    const hint = explainDenial(
      input({ granted: { value: 'system/Patient.r', source: 'token-response' } })
    );
    expect(text(hint)).toContain('`system/Patient.r` names `Patient`, but not search (`s`)');
  });

  it('points at the registration when a granted scope covers the request', () => {
    const hint = explainDenial(
      input({ granted: { value: 'system/*.rs', source: 'token-response' } })
    );
    expect(text(hint)).toContain('which `system/*.rs` allows');
    expect(text(hint)).toContain('token claims a permission the server refused');
    expect(text(hint)).toContain('repeat the requested scopes');
  });

  it('counts SMART v1 scopes', () => {
    const hint = explainDenial(
      input({ granted: { value: 'system/Patient.read', source: 'token-response' } })
    );
    expect(text(hint)).toContain('which `system/Patient.read` allows');
  });

  it('notes the patient compartment for patient/ scopes', () => {
    const hint = explainDenial(
      input({
        exchange: exchange(403, 'Patient/other'),
        launchType: 'standalone',
        patient: 'patient-a',
        granted: { value: 'patient/*.rs', source: 'token-response' }
      })
    );
    expect(text(hint)).toContain('patient in context (`Patient/patient-a`)');
  });

  it('suggests a patient/ scope in a patient launch', () => {
    const hint = explainDenial(
      input({
        exchange: exchange(403, 'Practitioner/1'),
        launchType: 'standalone',
        patient: 'patient-a',
        granted: { value: 'openid patient/Patient.rs', source: 'token-response' }
      })
    );
    expect(text(hint)).toContain('`patient/Practitioner.r`');
  });

  it('notes constrained scopes', () => {
    const hint = explainDenial(
      input({
        exchange: exchange(403, 'Observation'),
        granted: { value: 'system/Observation.rs?category=laboratory', source: 'token-response' }
      })
    );
    expect(text(hint)).toContain('search-parameter constraints');
  });

  it('says when the scopes are only implied', () => {
    const hint = explainDenial(
      input({ granted: { value: 'system/Observation.rs', source: 'implied' } })
    );
    expect(text(hint)).toContain('nothing confirms they were granted');
  });

  it('lists the granted scopes for an operation', () => {
    const hint = explainDenial(input({ exchange: exchange(403, 'Patient/1/$everything') }));
    expect(text(hint)).toContain('`$everything` is an operation');
    expect(text(hint)).toContain('Granted: `system/Observation.rs`');
  });

  it('reads an insufficient_scope challenge', () => {
    const hint = explainDenial(
      input({
        exchange: exchange(403, 'Patient', {
          'www-authenticate':
            'Bearer error="insufficient_scope", error_description="Scope missing", scope="system/Patient.rs"'
        })
      })
    );
    expect(hint?.challenge?.error).toBe('insufficient_scope');
    expect(text(hint)).toContain('`error="insufficient_scope"` (`Scope missing`)');
    expect(text(hint)).toContain('needs `system/Patient.rs`');
    expect(text(hint)).not.toContain('RFC 6750');
    // What the session holds comes before what the server's challenge says.
    expect(text(hint).indexOf('no granted scope')).toBeLessThan(text(hint).indexOf('challenge'));
  });

  it('reports insufficient_scope sent with 401', () => {
    const hint = explainDenial(
      input({
        exchange: exchange(401, 'Patient', {
          'www-authenticate': 'Bearer error="insufficient_scope"'
        })
      })
    );
    expect(text(hint)).toContain('RFC 6750 sends `insufficient_scope` with 403, not 401');
  });

  it('says when the challenge could not be read', () => {
    const hint = explainDenial(
      input({ exchange: exchange(403, 'Patient', {}, ['www-authenticate']) })
    );
    expect(text(hint)).toContain('Access-Control-Expose-Headers');
  });

  it('keeps backticks in server text from breaking out of code', () => {
    const hint = explainDenial(
      input({
        exchange: exchange(403, 'Patient', {
          'www-authenticate': 'Bearer error="x`y"'
        })
      })
    );
    expect(text(hint)).toContain('`error="x\'y"`');
  });

  it('explains a 401 as the token not being accepted', () => {
    const hint = explainDenial(input({ exchange: exchange(401, 'Patient') }));
    expect(hint?.title).toMatch(/did not accept the token/);
    expect(text(hint)).toContain('issued for another server');
  });

  it('says when the token had expired', () => {
    const hint = explainDenial(input({ exchange: exchange(401, 'Patient'), expired: true }));
    expect(text(hint)).toContain('had expired');
  });

  it('does not blame scopes when no token was sent', () => {
    const hint = explainDenial(input({ credential: 'none', exchange: exchange(401, 'Patient') }));
    expect(hint?.title).toMatch(/No access token/);
    expect(text(hint)).not.toContain('Granted');
  });

  it('says when the token was kept from another origin', () => {
    const hint = explainDenial(
      input({ credential: 'withheld', exchange: exchange(401, 'Patient') })
    );
    expect(hint?.title).toMatch(/not sent to this server/);
    expect(text(hint)).toContain('`https://fhir.test` is not the FHIR base');
    expect(text(hint)).not.toContain('Granted');
  });

  it('does not blame scopes when the user sent their own Authorization', () => {
    const hint = explainDenial(input({ credential: 'own-header' }));
    expect(hint?.title).toMatch(/own Authorization/);
    expect(text(hint)).not.toContain('Granted');
  });
});
