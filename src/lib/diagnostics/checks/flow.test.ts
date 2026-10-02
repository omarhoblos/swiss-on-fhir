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
import { DEFAULTS } from '$lib/config/defaults';
import { REDACTED } from '$lib/http/exchange';
import type { DiagnosticsContext, DiagnosticsSession } from '../types';
import { flowChecks } from './flow';

const check = flowChecks.find((c) => c.id === 'flow.fhir-user')!;
const BASE = 'http://localhost:8000';

interface Seen {
  url: string;
  authorization?: string;
}

/** A FHIR server holding `resources`, keyed by path; anything else is 404. */
function server(resources: Record<string, unknown>, seen: Seen[] = [], status?: number) {
  return (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    seen.push({ url, authorization: headers.Authorization });
    const path = new URL(url).pathname;
    const body = resources[path];
    const code = status ?? (body ? 200 : 404);
    return new Response(
      JSON.stringify(
        body ?? {
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', code: 'not-found', diagnostics: 'not known' }]
        }
      ),
      { status: code, headers: { 'content-type': 'application/fhir+json' } }
    );
  }) as typeof fetch;
}

function ctx(session: Partial<DiagnosticsSession> | null, fetchImpl: typeof fetch, redact = true) {
  return {
    config: { ...DEFAULTS, fhirBaseUrl: BASE, redactSecrets: redact },
    origin: 'http://localhost:4200',
    endpoints: {},
    docs: {},
    gates: null,
    documentUrls: {},
    session: session && {
      hasRefreshToken: false,
      staleConfig: false,
      grantedScopes: 'openid fhirUser launch/patient patient/*.read',
      tokenBase: BASE,
      accessToken: 'access-1',
      idTokenVerified: true,
      patient: 'patient-a',
      ...session
    },
    fetchImpl
  } satisfies DiagnosticsContext;
}

const PATIENT = { '/Patient/patient-a': { resourceType: 'Patient', id: 'patient-a' } };
const user = (
  value: string,
  source: 'id-token' | 'token-response' | 'access-token' = 'id-token'
) => ({
  fhirUser: { value, source }
});

describe('fhirUser check', () => {
  it('skips without a session', async () => {
    const r = await check.run(ctx(null, server({})));
    expect(r.status).toBe('skip');
  });

  it('skips when fhirUser was not asked for, and warns when it was granted but not issued', async () => {
    const notAsked = await check.run(ctx({ grantedScopes: 'openid patient/*.read' }, server({})));
    expect(notAsked.status).toBe('skip');

    const missing = await check.run(ctx({}, server({})));
    expect(missing.status).toBe('warn');
    expect(missing.summary).toMatch(/granted `fhirUser` but issued no/);
  });

  it('passes for the patient in context, read from the FHIR base with the token', async () => {
    const seen: Seen[] = [];
    const r = await check.run(ctx(user(`${BASE}/Patient/patient-a`), server(PATIENT, seen)));

    expect(r.status).toBe('pass');
    expect(r.summary).toBe('`fhirUser` resolves to `Patient/patient-a`, the patient in context.');
    expect(seen).toEqual([{ url: `${BASE}/Patient/patient-a`, authorization: 'Bearer access-1' }]);
  });

  it('resolves a relative claim against the FHIR base', async () => {
    const seen: Seen[] = [];
    const r = await check.run(ctx(user('Patient/patient-a'), server(PATIENT, seen)));
    expect(r.status).toBe('pass');
    expect(seen[0]?.url).toBe(`${BASE}/Patient/patient-a`);
  });

  it('redacts the token in the exchange it shows, unless redaction is off', async () => {
    const shown = await check.run(ctx(user('Patient/patient-a'), server(PATIENT)));
    expect(shown.exchanges[0]?.request.headers.Authorization).toBe(REDACTED);

    const raw = await check.run(ctx(user('Patient/patient-a'), server(PATIENT), false));
    expect(raw.exchanges[0]?.request.headers.Authorization).toBe('Bearer access-1');
  });

  it('fails a claim naming a resource the server does not have', async () => {
    const r = await check.run(ctx(user(`${BASE}/RelatedPerson/3`), server(PATIENT)));
    expect(r.status).toBe('fail');
    expect(r.summary).toBe(
      '`fhirUser` names `RelatedPerson/3`, which the FHIR server does not have (404).'
    );
    expect(r.remediations.map((x) => x.id)).toEqual(['fhir-user-unresolved']);
  });

  it('looks up a claim on another server by type and id on the FHIR base, and never sends it the token', async () => {
    // The Smile CDR test bed case: the claim is built on the authorization
    // server's address, not the FHIR endpoint.
    const seen: Seen[] = [];
    const r = await check.run(
      ctx(user('http://localhost:9200/fhir/RelatedPerson/3'), server({}, seen))
    );

    expect(seen.map((s) => s.url)).toEqual([`${BASE}/RelatedPerson/3`]);
    expect(seen.some((s) => s.url.includes(':9200'))).toBe(false);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/not the FHIR base/);
  });

  it('warns, not fails, when the server will not return it to this session', async () => {
    const r = await check.run(ctx(user('Practitioner/p1'), server({}, [], 403)));
    expect(r.status).toBe('warn');
    expect(r.summary).toMatch(/would not return `Practitioner\/p1` to this session \(403\)/);
    expect(r.detail).toMatch(/Granted: `openid fhirUser/);
  });

  it('checks a RelatedPerson belongs to the patient in context', async () => {
    const related = (reference?: string) => ({
      '/RelatedPerson/rp1': {
        resourceType: 'RelatedPerson',
        id: 'rp1',
        ...(reference ? { patient: { reference } } : {})
      }
    });

    const same = await check.run(
      ctx(user('RelatedPerson/rp1'), server(related('Patient/patient-a')))
    );
    expect(same.status).toBe('pass');
    expect(same.detail).toMatch(
      /`RelatedPerson.patient` is `Patient\/patient-a`, the patient in context/
    );

    const other = await check.run(
      ctx(user('RelatedPerson/rp1'), server(related('Patient/someone-else')))
    );
    expect(other.status).toBe('warn');
    expect(other.detail).toMatch(
      /is `Patient\/someone-else`, but the launch context is `Patient\/patient-a`/
    );

    const none = await check.run(ctx(user('RelatedPerson/rp1'), server(related())));
    expect(none.status).toBe('warn');
    expect(none.detail).toMatch(/`RelatedPerson.patient` is missing/);
  });

  it('warns when a patient user is not the patient in context', async () => {
    const r = await check.run(
      ctx(
        user('Patient/patient-b'),
        server({ '/Patient/patient-b': { resourceType: 'Patient', id: 'patient-b' } })
      )
    );
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(
      /The user is `Patient\/patient-b`, but the launch context is `Patient\/patient-a`/
    );
  });

  it('warns when the claim came from an ID token that did not verify, or from the access token', async () => {
    const unverified = await check.run(
      ctx({ ...user('Patient/patient-a'), idTokenVerified: false }, server(PATIENT))
    );
    expect(unverified.status).toBe('warn');
    expect(unverified.detail).toMatch(/did not verify/);

    const fromAccess = await check.run(
      ctx(user('Patient/patient-a', 'access-token'), server(PATIENT))
    );
    expect(fromAccess.status).toBe('warn');
    expect(fromAccess.detail).toMatch(/opaque to the app/);
  });

  it('warns about a type SMART does not allow, and still reads it', async () => {
    const seen: Seen[] = [];
    const r = await check.run(
      ctx(user('Device/d1'), server({ '/Device/d1': { resourceType: 'Device', id: 'd1' } }, seen))
    );
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/`Device` is not one of the types SMART allows/);
    expect(seen).toHaveLength(1);
  });

  it('warns when the server answers with a different resource', async () => {
    const r = await check.run(
      ctx(
        user('Patient/patient-a'),
        server({ '/Patient/patient-a': { resourceType: 'Patient', id: 'other' } })
      )
    );
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/answered with `Patient\/other`, not `Patient\/patient-a`/);
  });

  it('fails a claim that is not a reference at all', async () => {
    const r = await check.run(ctx(user('https://'), server({})));
    expect(r.status).toBe('fail');
    expect(r.summary).toMatch(/not a reference to a FHIR resource/);
  });

  it('encodes an id taken from the claim before putting it in a URL', async () => {
    const seen: Seen[] = [];
    await check.run(ctx(user('Patient/a b?c'), server({}, seen)));
    expect(seen[0]?.url).toBe(`${BASE}/Patient/a%20b%3Fc`);
  });

  it('reports a server it cannot reach as a failure with the diagnosis', async () => {
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const r = await check.run(ctx(user('Patient/patient-a'), down));
    expect(r.status).toBe('fail');
    expect(r.summary).toBe('Could not read `Patient/patient-a` from the FHIR server.');
  });
});
