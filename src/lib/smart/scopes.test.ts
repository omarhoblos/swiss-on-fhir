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
import {
  diffScopes,
  resolveGrantedScopes,
  hasRealReduction,
  parseScope,
  scopeEquivalent
} from './scopes';

describe('parseScope', () => {
  it('parses the OIDC and launch scopes', () => {
    expect(parseScope('openid').kind).toBe('openid');
    expect(parseScope('offline_access').kind).toBe('offline_access');
    // A bare `launch` (EHR launch) carries no target, unlike launch/patient.
    const bare = parseScope('launch');
    expect(bare.kind).toBe('launch');
    if (bare.kind === 'launch') expect(bare.target).toBeUndefined();
    expect(parseScope('launch/patient')).toMatchObject({ kind: 'launch', target: 'patient' });
    expect(parseScope('launch/encounter')).toMatchObject({ kind: 'launch', target: 'encounter' });
  });

  it('parses SMART 1.0 syntax and expands the operations', () => {
    const read = parseScope('patient/Observation.read');
    expect(read).toMatchObject({
      kind: 'fhir',
      context: 'patient',
      resource: 'Observation',
      v1Legacy: 'read'
    });
    if (read.kind === 'fhir') expect([...read.ops].sort()).toEqual(['r', 's']);

    // v1 `.write` covers create, update and delete.
    const write = parseScope('patient/Observation.write');
    if (write.kind === 'fhir') expect([...write.ops].sort()).toEqual(['c', 'd', 'u']);

    const all = parseScope('patient/*.*');
    if (all.kind === 'fhir') expect([...all.ops].sort()).toEqual(['c', 'd', 'r', 's', 'u']);
  });

  it('parses SMART 2.0 letter sets', () => {
    const rs = parseScope('patient/Observation.rs');
    if (rs.kind === 'fhir') expect([...rs.ops].sort()).toEqual(['r', 's']);

    const cruds = parseScope('system/*.cruds');
    expect(cruds).toMatchObject({ kind: 'fhir', context: 'system', resource: '*' });
  });

  it('parses SMART 2.0 search-parameter constraints', () => {
    // Without this these fall into `unknown` and vanish from the diff.
    const scope = parseScope('patient/Observation.rs?category=laboratory');
    expect(scope).toMatchObject({ kind: 'fhir', resource: 'Observation' });
    if (scope.kind === 'fhir') expect(scope.params).toEqual({ category: 'laboratory' });
  });

  it('returns unknown for something it cannot interpret', () => {
    expect(parseScope('nonsense').kind).toBe('unknown');
    expect(parseScope('patient/Observation.xyz').kind).toBe('unknown');
  });
});

describe('scopeEquivalent', () => {
  it('treats v1 .read and v2 .rs as the same grant', () => {
    expect(
      scopeEquivalent(parseScope('patient/Observation.read'), parseScope('patient/Observation.rs'))
    ).toBe(true);
  });

  it('treats v1 .* and v2 .cruds as the same grant', () => {
    expect(scopeEquivalent(parseScope('patient/*.*'), parseScope('patient/*.cruds'))).toBe(true);
  });

  it('does not equate different contexts or resources', () => {
    expect(
      scopeEquivalent(parseScope('patient/Observation.rs'), parseScope('user/Observation.rs'))
    ).toBe(false);
    expect(
      scopeEquivalent(parseScope('patient/Observation.rs'), parseScope('patient/Condition.rs'))
    ).toBe(false);
  });

  it('does not equate different search-parameter constraints', () => {
    expect(
      scopeEquivalent(
        parseScope('patient/Observation.rs?category=laboratory'),
        parseScope('patient/Observation.rs?category=vital-signs')
      )
    ).toBe(false);
  });
});

describe('diffScopes', () => {
  it('reports identical scopes as unchanged', () => {
    const diff = diffScopes('openid patient/*.read', 'openid patient/*.read');
    expect(diff.unchanged).toHaveLength(2);
    expect(diff.dropped).toEqual([]);
    expect(hasRealReduction(diff)).toBe(false);
  });

  it('classifies a v1 to v2 rewrite as normalized, NOT dropped', () => {
    // A server that normalises syntax would otherwise look like it stripped
    // every scope you asked for.
    const diff = diffScopes('patient/Observation.read', 'patient/Observation.rs');
    expect(diff.normalized).toHaveLength(1);
    expect(diff.dropped).toEqual([]);
    expect(diff.narrowed).toEqual([]);
    expect(hasRealReduction(diff)).toBe(false);
  });

  it('reports a genuinely withheld scope as dropped', () => {
    const diff = diffScopes('openid patient/*.read offline_access', 'openid patient/*.read');
    expect(diff.dropped.map((s) => s.raw)).toEqual(['offline_access']);
    expect(hasRealReduction(diff)).toBe(true);
  });

  it('reports a resource narrowing as narrowed, not dropped', () => {
    const diff = diffScopes('patient/*.rs', 'patient/Observation.rs');
    expect(diff.narrowed).toHaveLength(1);
    expect(diff.dropped).toEqual([]);
    expect(hasRealReduction(diff)).toBe(true);
  });

  it('reports an operation narrowing as narrowed', () => {
    const diff = diffScopes('patient/Observation.cruds', 'patient/Observation.rs');
    expect(diff.narrowed).toHaveLength(1);
    expect(hasRealReduction(diff)).toBe(true);
  });

  it('reports an added search-parameter constraint as narrowed', () => {
    const diff = diffScopes('patient/Observation.rs', 'patient/Observation.rs?category=laboratory');
    expect(diff.narrowed).toHaveLength(1);
  });

  it('reports a scope the server added on its own', () => {
    const diff = diffScopes('openid', 'openid profile');
    expect(diff.added.map((s) => s.raw)).toEqual(['profile']);
  });

  it('treats an empty granted list as everything dropped', () => {
    // Deciding what an omitted `scope` means is resolveGrantedScopes' job;
    // by the time a diff runs, undefined really does mean nothing.
    const diff = diffScopes('openid patient/*.read', undefined);
    expect(diff.dropped).toHaveLength(2);
  });

  it('counts one broader grant as covering several requests', () => {
    // The backend services case: two v1 scopes collapsed into one wildcard.
    const diff = diffScopes('system/*.read system/*.write', 'system/*.*');
    expect(diff.dropped).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.covered.map((c) => [c.from.raw, c.by.raw])).toEqual([
      ['system/*.read', 'system/*.*'],
      ['system/*.write', 'system/*.*']
    ]);
    expect(hasRealReduction(diff)).toBe(false);
  });

  it('covers across syntaxes and from a wildcard resource', () => {
    const diff = diffScopes('system/Patient.read', 'system/*.cruds');
    expect(diff.covered.map((c) => c.by.raw)).toEqual(['system/*.cruds']);
  });

  it('does not let a constrained or other-context grant cover a request', () => {
    expect(diffScopes('system/*.read', 'system/*.rs?category=lab').covered).toEqual([]);
    expect(diffScopes('system/*.read', 'patient/*.*').dropped).toHaveLength(1);
  });

  it('flags scopes missing from the advertised list separately', () => {
    const diff = diffScopes('openid patient/*.read', 'openid patient/*.read', ['openid']);
    expect(diff.unsupportedByServer.map((s) => s.raw)).toEqual(['patient/*.read']);
    // Still granted, so not a reduction.
    expect(hasRealReduction(diff)).toBe(false);
  });
});

describe('resolveGrantedScopes', () => {
  const requested = 'system/*.read system/*.write';

  it('prefers the token response', () => {
    expect(resolveGrantedScopes('system/*.read', { scope: 'system/*.*' }, requested)).toEqual({
      value: 'system/*.read',
      source: 'token-response'
    });
  });

  it('falls back to the access token scope claim', () => {
    expect(resolveGrantedScopes(undefined, { scope: 'system/*.*' }, requested)).toEqual({
      value: 'system/*.*',
      source: 'access-token'
    });
  });

  it('reads an scp array', () => {
    expect(
      resolveGrantedScopes(undefined, { scp: ['system/*.read', 'system/*.write'] }, requested)
    ).toEqual({ value: requested, source: 'access-token' });
  });

  it('treats a scope stated nowhere as granted as requested', () => {
    // RFC 6749 5.1: `scope` may be omitted when identical to the request.
    expect(resolveGrantedScopes(undefined, null, requested)).toEqual({
      value: requested,
      source: 'implied'
    });
  });
});
