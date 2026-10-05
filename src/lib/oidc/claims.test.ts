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
  CLAIMS,
  HEADER_PARAMETERS,
  CUSTOM_CLAIM_MESSAGE,
  claimGroups,
  claimText,
  describeClaim,
  matchesClaim
} from './claims';

describe('describeClaim', () => {
  it('defines the OpenID Connect, JWT, OAuth and SMART claims', () => {
    for (const name of ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce', 'azp', 'at_hash', 'email']) {
      expect(describeClaim(name).known, name).toBe(true);
    }
    for (const name of ['nbf', 'jti', 'scope', 'client_id', 'sid', 'fhirUser', 'patient']) {
      expect(describeClaim(name).known, name).toBe(true);
    }
  });

  it('calls anything else a custom claim, in exactly the agreed words', () => {
    expect(CUSTOM_CLAIM_MESSAGE).toBe(
      'This custom claim comes from your server & is not pre-defined in the spec.'
    );
    for (const name of ['realm_access', 'resource_access', 'typ', 'session_state', 'roles']) {
      expect(describeClaim(name)).toEqual({ known: false, text: CUSTOM_CLAIM_MESSAGE });
    }
  });

  it('is not fooled by claim names that exist on every object', () => {
    // Claim names come from the server. An object lookup would find these on
    // the prototype and render a function as a definition.
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(describeClaim(name).known, name).toBe(false);
    }
  });

  it('is case-sensitive, as JWT claim names are', () => {
    expect(describeClaim('fhirUser').known).toBe(true);
    expect(describeClaim('fhiruser').known).toBe(false);
    expect(describeClaim('ISS').known).toBe(false);
  });
});

describe('header parameters', () => {
  it('defines every JOSE header parameter: JWS, JWE, JWA, replicated JWT claims and b64', () => {
    const jws = ['alg', 'jku', 'jwk', 'kid', 'x5u', 'x5c', 'x5t', 'x5t#S256', 'typ', 'cty', 'crit'];
    const jwe = ['enc', 'zip'];
    const jwa = ['epk', 'apu', 'apv', 'iv', 'tag', 'p2s', 'p2c'];
    const replicated = ['iss', 'sub', 'aud'];
    for (const name of [...jws, ...jwe, ...jwa, ...replicated, 'b64']) {
      expect(describeClaim(name, 'header').known, name).toBe(true);
    }
    expect(HEADER_PARAMETERS.size).toBe(
      jws.length + jwe.length + jwa.length + replicated.length + 1
    );
  });

  it('keeps the header and the payload apart, since a name can mean different things', () => {
    // typ is a standard header parameter, but a typ claim is an identity provider's own.
    expect(describeClaim('typ', 'header').known).toBe(true);
    expect(describeClaim('typ', 'claim').known).toBe(false);
    // alg belongs in the header; in the payload it is just a custom claim.
    expect(describeClaim('alg').known).toBe(false);
    // Present in both, with different meanings.
    const headerIss = describeClaim('iss', 'header');
    const claimIss = describeClaim('iss', 'claim');
    expect(headerIss.known && claimIss.known).toBe(true);
    if (headerIss.known && claimIss.known) {
      expect(headerIss.definition.summary).not.toBe(claimIss.definition.summary);
      expect(headerIss.definition.source.section).toBe('§5.3');
    }
  });

  it('calls an unknown header parameter custom, and is not fooled by prototype names', () => {
    for (const name of ['x-vendor', '__proto__', 'constructor', 'KID']) {
      expect(describeClaim(name, 'header')).toEqual({ known: false, text: CUSTOM_CLAIM_MESSAGE });
    }
    expect(claimText('kid', 'header')).toMatch(/^Key ID/);
  });
});

describe('the definitions', () => {
  it('each has a summary, a name matching its key, and an https link to its section', () => {
    for (const [key, definition] of [...CLAIMS, ...HEADER_PARAMETERS]) {
      expect(definition.name).toBe(key);
      expect(definition.summary.length, key).toBeGreaterThan(10);
      expect(definition.source.section, key).not.toBe('');
      expect(new URL(definition.source.url).protocol, key).toBe('https:');
    }
  });

  it('groups every definition of each kind exactly once, by specification', () => {
    for (const [kind, map] of [
      ['claim', CLAIMS],
      ['header', HEADER_PARAMETERS]
    ] as const) {
      const listed = claimGroups(kind).flatMap((group) => group.claims.map((claim) => claim.name));
      expect(listed).toHaveLength(map.size);
      expect(new Set(listed).size).toBe(map.size);
    }
    expect(claimGroups('header').map((group) => group.spec)).toEqual([
      'JSON Web Signature (RFC 7515)',
      'JSON Web Encryption (RFC 7516)',
      'JSON Web Algorithms (RFC 7518)',
      'JSON Web Token (RFC 7519)',
      'JWS Unencoded Payload Option (RFC 7797)'
    ]);
    const groups = claimGroups();
    expect(groups.map((group) => group.spec)).toContain('OpenID Connect Core 1.0');
    expect(groups.map((group) => group.spec)).toContain('SMART App Launch');
    for (const group of groups) {
      expect(group.claims.every((claim) => claim.source.spec === group.spec)).toBe(true);
    }
  });
});

describe('claimText', () => {
  it('joins the summary and detail for hover text', () => {
    const exp = CLAIMS.get('exp')!;
    expect(claimText('exp')).toBe(exp.summary);
    const nonce = CLAIMS.get('nonce')!;
    expect(claimText('nonce')).toBe(`${nonce.summary} ${nonce.detail}`);
    expect(claimText('realm_access')).toBe(CUSTOM_CLAIM_MESSAGE);
  });
});

describe('matchesClaim', () => {
  const all = [...CLAIMS.values()];
  const search = (query: string) =>
    all.filter((claim) => matchesClaim(claim, query)).map((claim) => claim.name);

  it('matches on the name, ignoring case and surrounding space', () => {
    expect(search('email')).toEqual(['email', 'email_verified']);
    expect(search('  EMAIL ')).toEqual(['email', 'email_verified']);
  });

  it('matches on the meaning and the specification', () => {
    expect(search('expir')).toContain('exp');
    expect(search('smart')).toEqual(
      expect.arrayContaining(['fhirUser', 'patient', 'encounter', 'fhirContext'])
    );
  });

  it('matches everything when empty, and nothing for gibberish', () => {
    expect(search('')).toHaveLength(CLAIMS.size);
    expect(search('zzqxv')).toEqual([]);
  });
});
