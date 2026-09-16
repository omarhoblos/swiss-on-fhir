import { describe, expect, it } from 'vitest';
import { jwksCandidates } from './jwks';

describe('jwksCandidates', () => {
  it('tries every advertised value before guessing anything', () => {
    /**
     * The real case, from a Smile CDR deployment: smart-configuration
     * advertises `/.well-known/jwks.json`, which redirects and holds no keys,
     * while openid-configuration advertises `/jwk`, which works. Endpoint
     * precedence keeps only the first, so the value that works is discovered
     * and then discarded -- it has to be a candidate, and ahead of any guess.
     */
    const candidates = jwksCandidates(
      ['https://idp.test/.well-known/jwks.json', 'https://idp.test/jwk'],
      'https://idp.test'
    );

    expect(candidates.slice(0, 2)).toEqual([
      'https://idp.test/.well-known/jwks.json',
      'https://idp.test/jwk'
    ]);
  });

  it('tries the advertised URL first, since it is the only correct answer', () => {
    expect(jwksCandidates(['https://idp.test/oauth/keys'], 'https://idp.test')[0]).toBe(
      'https://idp.test/oauth/keys'
    );
  });

  it('toggles the .json suffix, whichever spelling the server chose', () => {
    expect(jwksCandidates(['https://idp.test/jwk'], undefined)).toEqual([
      'https://idp.test/jwk',
      'https://idp.test/jwk.json'
    ]);
    expect(jwksCandidates(['https://idp.test/jwks.json'], undefined)).toEqual([
      'https://idp.test/jwks.json',
      'https://idp.test/jwks'
    ]);
  });

  it('keeps a query string when toggling the suffix', () => {
    expect(jwksCandidates(['https://idp.test/jwk?realm=a'], undefined)).toEqual([
      'https://idp.test/jwk?realm=a',
      'https://idp.test/jwk.json?realm=a'
    ]);
  });

  it('does not append .json to a path ending in a slash', () => {
    expect(jwksCandidates(['https://idp.test/keys/'], undefined)).toEqual([
      'https://idp.test/keys/'
    ]);
  });

  it('guesses /jwk under the issuer when nothing was advertised', () => {
    expect(jwksCandidates([], 'https://idp.test')).toEqual([
      'https://idp.test/jwk',
      'https://idp.test/jwk.json',
      'https://idp.test/.well-known/jwks.json'
    ]);
  });

  it('does not double the slash on an issuer that ends with one', () => {
    expect(jwksCandidates([], 'https://idp.test/')).toContain('https://idp.test/jwk');
  });

  it('preserves an issuer path', () => {
    expect(jwksCandidates([], 'https://idp.test/realms/swiss')).toEqual([
      'https://idp.test/realms/swiss/jwk',
      'https://idp.test/realms/swiss/jwk.json',
      'https://idp.test/realms/swiss/.well-known/jwks.json'
    ]);
  });

  it('never probes the same URL twice', () => {
    const candidates = jwksCandidates(['https://idp.test/jwk'], 'https://idp.test');
    expect(candidates).toEqual([...new Set(candidates)]);
    expect(candidates).toEqual([
      'https://idp.test/jwk',
      'https://idp.test/jwk.json',
      'https://idp.test/.well-known/jwks.json'
    ]);
  });

  it('does not normalise an advertised URL, which the server has to match', () => {
    // new URL() would append a trailing slash to a bare origin; this page
    // reports what the server actually said.
    expect(jwksCandidates(['https://IdP.test/jwk'], undefined)[0]).toBe('https://IdP.test/jwk');
  });

  it('drops a non-http value rather than building an href from it', () => {
    expect(jwksCandidates(['javascript:alert(1)'], undefined)).toEqual([]);
    expect(jwksCandidates(['not a url'], undefined)).toEqual([]);
    expect(jwksCandidates([undefined], undefined)).toEqual([]);
    expect(jwksCandidates([], undefined)).toEqual([]);
    expect(jwksCandidates([''], '')).toEqual([]);
  });
});
