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
import {
  audValue,
  buildAuthorizeUrl,
  describeAuthorizeUrl,
  type AuthorizeParams
} from './authorize';

const ENDPOINT = 'https://idp.test/authorize?tenant=t1';

function params(overrides: Partial<AuthorizeParams> = {}): AuthorizeParams {
  return {
    authorizationEndpoint: ENDPOINT,
    config: {
      ...DEFAULTS,
      fhirBaseUrl: 'https://fhir.test/r4/',
      clientId: 'swiss',
      clientSecret: 'hunter2',
      scopes: 'openid launch/patient patient/*.read'
    },
    pkce: { method: 'S256', verifier: 'v'.repeat(43), challenge: 'challenge-1' },
    state: 'state-1',
    nonce: 'nonce-1',
    redirectUri: 'http://localhost:4200/callback',
    ...overrides
  };
}

describe('buildAuthorizeUrl', () => {
  it('builds a code-flow request with PKCE, nonce and aud, keeping the endpoint query', () => {
    const url = buildAuthorizeUrl(params());
    const q = url.searchParams;
    expect(url.origin + url.pathname).toBe('https://idp.test/authorize');
    expect(q.get('tenant')).toBe('t1');
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe('swiss');
    expect(q.get('redirect_uri')).toBe('http://localhost:4200/callback');
    expect(q.get('scope')).toBe('openid launch/patient patient/*.read');
    expect(q.get('state')).toBe('state-1');
    expect(q.get('nonce')).toBe('nonce-1');
    expect(q.get('code_challenge')).toBe('challenge-1');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('aud')).toBe('https://fhir.test/r4/');
    expect(q.has('launch')).toBe(false);
  });

  it('never puts the client secret on the URL', () => {
    const url = buildAuthorizeUrl(params()).toString();
    expect(url).not.toContain('hunter2');
    expect(url).not.toContain('client_secret');
  });

  it('omits the nonce when there is no ID token to bind it to', () => {
    const url = buildAuthorizeUrl(params({ nonce: undefined }));
    expect(url.searchParams.has('nonce')).toBe(false);
  });

  it('passes launch and the EHR iss as aud through for an EHR launch', () => {
    const url = buildAuthorizeUrl(
      params({
        launch: 'launch-token',
        audienceOverride: 'https://ehr.test/fhir',
        scopesOverride: 'openid launch patient/*.read'
      })
    );
    expect(url.searchParams.get('launch')).toBe('launch-token');
    expect(url.searchParams.get('aud')).toBe('https://ehr.test/fhir');
    expect(url.searchParams.get('scope')).toBe('openid launch patient/*.read');
  });

  it('applies each aud variant', () => {
    const base = 'https://fhir.test/r4/';
    expect(audValue(base, 'exact')).toBe(base);
    expect(audValue(base, 'no-trailing-slash')).toBe('https://fhir.test/r4');
    expect(audValue('https://fhir.test/r4', 'trailing-slash')).toBe('https://fhir.test/r4/');
    expect(audValue(base, 'omit')).toBeNull();
    expect(audValue('', 'exact')).toBeNull();

    const omitted = buildAuthorizeUrl(params({ config: { ...params().config, audMode: 'omit' } }));
    expect(omitted.searchParams.has('aud')).toBe(false);
  });

  it('describes the parameters in request order for the preview', () => {
    const names = describeAuthorizeUrl(buildAuthorizeUrl(params())).map((p) => p.name);
    expect(names.slice(0, 2)).toEqual(['tenant', 'response_type']);
    expect(names).toContain('code_challenge');
  });
});
