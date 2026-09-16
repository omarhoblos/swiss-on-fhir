import { describe, expect, it } from 'vitest';
import { jwksCandidates, originOf } from './jwks';

describe('jwksCandidates', () => {
  it('tries the advertised URL first, since it is the only correct answer', () => {
    const candidates = jwksCandidates('https://idp.test/oauth/keys', 'https://idp.test');
    expect(candidates[0]).toBe('https://idp.test/oauth/keys');
  });

  it('tries /jwks when the advertised URL is /jwks.json', () => {
    const candidates = jwksCandidates('https://idp.test/jwks.json', undefined);
    expect(candidates).toEqual(['https://idp.test/jwks.json', 'https://idp.test/jwks']);
  });

  it('tries /jwks.json when the advertised URL is /jwks', () => {
    // The reported case: a server serving the key set at /jwks.
    const candidates = jwksCandidates('https://idp.test/jwks', undefined);
    expect(candidates).toEqual(['https://idp.test/jwks', 'https://idp.test/jwks.json']);
  });

  it('keeps a query string when switching spelling', () => {
    expect(jwksCandidates('https://idp.test/jwks?realm=a', undefined)).toEqual([
      'https://idp.test/jwks?realm=a',
      'https://idp.test/jwks.json?realm=a'
    ]);
  });

  it('falls back to paths under the issuer when nothing was advertised', () => {
    expect(jwksCandidates(undefined, 'https://idp.test')).toEqual([
      'https://idp.test/.well-known/jwks.json',
      'https://idp.test/jwks',
      'https://idp.test/jwks.json'
    ]);
  });

  it('does not double the slash on an issuer that ends with one', () => {
    expect(jwksCandidates(undefined, 'https://idp.test/')).toContain('https://idp.test/jwks');
  });

  it('preserves an issuer path', () => {
    expect(jwksCandidates(undefined, 'https://idp.test/realms/swiss')).toEqual([
      'https://idp.test/realms/swiss/.well-known/jwks.json',
      'https://idp.test/realms/swiss/jwks',
      'https://idp.test/realms/swiss/jwks.json'
    ]);
  });

  it('never probes the same URL twice', () => {
    const candidates = jwksCandidates('https://idp.test/jwks', 'https://idp.test');
    expect(candidates).toEqual([...new Set(candidates)]);
    expect(candidates).toEqual([
      'https://idp.test/jwks',
      'https://idp.test/jwks.json',
      'https://idp.test/.well-known/jwks.json'
    ]);
  });

  it('does not normalise the advertised URL, which the server has to match', () => {
    // new URL() would append a slash and lowercase nothing else of interest;
    // this page reports what the server said.
    expect(jwksCandidates('https://IdP.test/jwks', undefined)[0]).toBe('https://IdP.test/jwks');
  });

  it('rejects a non-http value rather than building an href from it', () => {
    expect(jwksCandidates('javascript:alert(1)', undefined)).toEqual([]);
    expect(jwksCandidates('not a url', undefined)).toEqual([]);
    expect(jwksCandidates(undefined, undefined)).toEqual([]);
    expect(jwksCandidates('', '')).toEqual([]);
  });
});

describe('originOf', () => {
  it('groups candidates that share a host, so an unreachable one is tried once', () => {
    expect(originOf('https://idp.test/jwks')).toBe('https://idp.test');
    expect(originOf('https://idp.test/jwks.json')).toBe(originOf('https://idp.test/other'));
  });

  it('returns null for a value that is not a URL', () => {
    expect(originOf('nope')).toBeNull();
  });
});
