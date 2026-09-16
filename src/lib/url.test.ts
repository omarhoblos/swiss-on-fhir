import { describe, expect, it } from 'vitest';
import { httpUrl, originOf } from './url';

describe('httpUrl', () => {
  it('accepts http and https', () => {
    expect(httpUrl('https://idp.test/jwk')).toBe('https://idp.test/jwk');
    expect(httpUrl('http://localhost:9200/jwk')).toBe('http://localhost:9200/jwk');
  });

  it('returns the original string rather than the normalised href', () => {
    // new URL('https://idp.test').href is 'https://idp.test/'. Linking to
    // that while displaying the unslashed form would point the link somewhere
    // other than its own text -- and a trailing slash is exactly the kind of
    // difference Swiss exists to show.
    expect(httpUrl('https://idp.test')).toBe('https://idp.test');
    expect(httpUrl('https://IdP.test/Path')).toBe('https://IdP.test/Path');
  });

  it('rejects anything that is not http, so it cannot reach an href', () => {
    expect(httpUrl('javascript:alert(1)')).toBeNull();
    expect(httpUrl('data:text/html,<script>1</script>')).toBeNull();
    expect(httpUrl('mailto:a@b.test')).toBeNull();
    expect(httpUrl('/relative/path')).toBeNull();
    expect(httpUrl('not a url')).toBeNull();
    expect(httpUrl('')).toBeNull();
    expect(httpUrl(undefined)).toBeNull();
    expect(httpUrl(null)).toBeNull();
  });
});

describe('originOf', () => {
  it('groups URLs that share a host', () => {
    expect(originOf('https://idp.test/jwk')).toBe('https://idp.test');
    expect(originOf('https://idp.test/jwk')).toBe(originOf('https://idp.test/other'));
  });

  it('distinguishes port and scheme', () => {
    expect(originOf('http://idp.test:9200/a')).not.toBe(originOf('http://idp.test/a'));
    expect(originOf('https://idp.test/a')).not.toBe(originOf('http://idp.test/a'));
  });

  it('returns null for a value that is not a URL', () => {
    expect(originOf('nope')).toBeNull();
  });
});
