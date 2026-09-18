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
  extractOauthUris,
  mergeEndpoints,
  normaliseFhirBase,
  readCapabilities,
  urlEquivalence
} from './discovery';

describe('urlEquivalence', () => {
  it('treats host case as trivial, because URL parsing normalises it anyway', () => {
    expect(urlEquivalence('https://IdP.Example/auth', 'https://idp.example/auth')).toBe(
      'trivially-different'
    );
  });

  it('treats an explicit default port as trivial', () => {
    expect(urlEquivalence('https://idp.example:443/auth', 'https://idp.example/auth')).toBe(
      'trivially-different'
    );
    expect(urlEquivalence('http://idp.example:80/auth', 'http://idp.example/auth')).toBe(
      'trivially-different'
    );
  });

  it('treats a trailing slash as trivial', () => {
    expect(urlEquivalence('https://idp.example/auth/', 'https://idp.example/auth')).toBe(
      'trivially-different'
    );
  });

  it('treats PATH case as significant', () => {
    // Most servers route case-sensitively, so /Auth and /auth are genuinely
    // different resources. Normalising this away would hide a real mismatch.
    expect(urlEquivalence('https://idp.example/Auth', 'https://idp.example/auth')).toBe(
      'different'
    );
  });

  it('treats a different host, scheme or port as different', () => {
    expect(urlEquivalence('https://a.example', 'https://b.example')).toBe('different');
    expect(urlEquivalence('http://a.example', 'https://a.example')).toBe('different');
    expect(urlEquivalence('https://a.example:8443', 'https://a.example')).toBe('different');
  });

  it('reports identical strings as identical', () => {
    expect(urlEquivalence('https://a.example/x', 'https://a.example/x')).toBe('identical');
  });
});

describe('normaliseFhirBase', () => {
  it('strips a trailing slash', () => {
    expect(normaliseFhirBase('https://fhir.example/baseR4/')).toBe('https://fhir.example/baseR4');
  });

  it('strips a trailing /metadata, which users paste often', () => {
    expect(normaliseFhirBase('https://fhir.example/baseR4/metadata')).toBe(
      'https://fhir.example/baseR4'
    );
  });
});

describe('mergeEndpoints', () => {
  it('prefers smart-configuration over openid-configuration', () => {
    // In SMART the FHIR server is authoritative about which authorization
    // server protects it.
    const { resolved } = mergeEndpoints({
      'smart-configuration': { token_endpoint: 'https://smart.example/token' },
      'openid-configuration': { token_endpoint: 'https://oidc.example/token' }
    });
    expect(resolved.token_endpoint?.value).toBe('https://smart.example/token');
    expect(resolved.token_endpoint?.source).toBe('smart-configuration');
  });

  it('lets a manual override beat everything', () => {
    const { resolved } = mergeEndpoints({
      manual: { token_endpoint: 'https://manual.example/token' },
      'smart-configuration': { token_endpoint: 'https://smart.example/token' }
    });
    expect(resolved.token_endpoint?.source).toBe('manual');
  });

  it('falls back to the CapabilityStatement when nothing else has the key', () => {
    const { resolved } = mergeEndpoints({
      'capability-statement': { authorization_endpoint: 'https://legacy.example/authorize' }
    });
    expect(resolved.authorization_endpoint?.source).toBe('capability-statement');
  });

  it('records a warn-level conflict for a genuine disagreement', () => {
    const { conflicts } = mergeEndpoints({
      'smart-configuration': { token_endpoint: 'https://smart.example/token' },
      'openid-configuration': { token_endpoint: 'https://other.example/token' }
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.severity).toBe('warn');
    expect(conflicts[0]?.chosen.value).toBe('https://smart.example/token');
    expect(conflicts[0]?.others[0]?.value).toBe('https://other.example/token');
  });

  it('downgrades a cosmetic-only disagreement to info', () => {
    const { conflicts } = mergeEndpoints({
      'smart-configuration': { token_endpoint: 'https://idp.example/token' },
      'openid-configuration': { token_endpoint: 'https://IdP.Example:443/token/' }
    });
    expect(conflicts[0]?.severity).toBe('info');
  });

  it('reports no conflict when the documents agree exactly', () => {
    const { conflicts } = mergeEndpoints({
      'smart-configuration': { token_endpoint: 'https://idp.example/token' },
      'openid-configuration': { token_endpoint: 'https://idp.example/token' }
    });
    expect(conflicts).toEqual([]);
  });

  it('ignores empty and non-string values', () => {
    const { resolved } = mergeEndpoints({
      'smart-configuration': { token_endpoint: '', authorization_endpoint: 42 }
    });
    expect(resolved.token_endpoint).toBeUndefined();
    expect(resolved.authorization_endpoint).toBeUndefined();
  });
});

describe('extractOauthUris', () => {
  const capabilityStatement = {
    resourceType: 'CapabilityStatement',
    rest: [
      {
        mode: 'server',
        security: {
          extension: [
            {
              url: 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris',
              extension: [
                { url: 'authorize', valueUri: 'https://legacy.example/authorize' },
                { url: 'token', valueUri: 'https://legacy.example/token' },
                { url: 'revoke', valueUri: 'https://legacy.example/revoke' }
              ]
            }
          ]
        }
      }
    ]
  };

  it('maps SMART 1.0 sub-extensions onto discovery keys', () => {
    expect(extractOauthUris(capabilityStatement)).toEqual({
      authorization_endpoint: 'https://legacy.example/authorize',
      token_endpoint: 'https://legacy.example/token',
      revocation_endpoint: 'https://legacy.example/revoke'
    });
  });

  it('returns undefined when the extension is absent', () => {
    expect(
      extractOauthUris({ resourceType: 'CapabilityStatement', rest: [{ mode: 'server' }] })
    ).toBeUndefined();
  });

  it('returns undefined for a non-CapabilityStatement', () => {
    expect(extractOauthUris(null)).toBeUndefined();
    expect(extractOauthUris('nope')).toBeUndefined();
  });
});

describe('readCapabilities', () => {
  it('reads the SMART 2.0 `capabilities` key', () => {
    expect(readCapabilities({ capabilities: ['launch-ehr'] })).toEqual(['launch-ehr']);
  });

  it('accepts the SMART 1.0 `smart_capabilities` spelling', () => {
    expect(readCapabilities({ smart_capabilities: ['launch-standalone'] })).toEqual([
      'launch-standalone'
    ]);
  });

  it('returns null when neither is present, which means "not advertised"', () => {
    // Distinct from an empty array, which means "advertised, and empty".
    expect(readCapabilities({})).toBeNull();
    expect(readCapabilities(undefined)).toBeNull();
  });
});
