import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './defaults';
import {
  authFingerprint,
  configEquivalentForAuth,
  deriveRedirectUri,
  mergeDefined,
  resolveSources
} from './merge';
import type { AppConfig } from './types';

describe('mergeDefined', () => {
  it('ignores undefined contributions rather than blanking the base', () => {
    const base = { a: 1, b: 2 };
    expect(mergeDefined(base, { a: undefined, b: 9 })).toEqual({ a: 1, b: 9 });
  });

  it('does not mutate the base', () => {
    const base = { a: 1 };
    mergeDefined(base, { a: 2 });
    expect(base).toEqual({ a: 1 });
  });
});

describe('layer precedence', () => {
  const runtime = { clientId: 'from-env', fhirBaseUrl: 'https://env.example' };
  const overrides = { clientId: 'from-ui' };
  const launch = { fhirBaseUrl: 'https://ehr-launch.example' };

  it('applies default < runtime < override < launch', () => {
    const base = mergeDefined(DEFAULTS, runtime);
    const withOverrides = mergeDefined(base, overrides);
    const effective = mergeDefined(withOverrides, launch);

    // default, untouched by any layer
    expect(effective.scopes).toBe(DEFAULTS.scopes);
    // override beats runtime
    expect(effective.clientId).toBe('from-ui');
    // launch beats runtime (the EHR's iss is definitionally correct)
    expect(effective.fhirBaseUrl).toBe('https://ehr-launch.example');
  });

  it('attributes each field to the right layer', () => {
    const sources = resolveSources(runtime, overrides, launch);
    expect(sources.clientId).toBe('override');
    expect(sources.fhirBaseUrl).toBe('launch');
    expect(sources.scopes).toBeUndefined(); // falls through to 'default'
  });
});

describe('authFingerprint', () => {
  const base: AppConfig = { ...DEFAULTS, clientSecret: '' };

  it('changes when an auth-critical field changes', () => {
    expect(authFingerprint({ ...base, authIssuer: 'https://other.example' })).not.toBe(
      authFingerprint(base)
    );
    expect(authFingerprint({ ...base, clientId: 'other' })).not.toBe(authFingerprint(base));
    expect(authFingerprint({ ...base, scopes: 'openid' })).not.toBe(authFingerprint(base));
    expect(authFingerprint({ ...base, skipIssuerCheck: true })).not.toBe(authFingerprint(base));
  });

  it('is stable when a non-auth-critical field changes', () => {
    // Pointing at a different FHIR server does not invalidate the tokens;
    // seeing them rejected there is a legitimate thing to test.
    expect(authFingerprint({ ...base, fhirBaseUrl: 'https://other.example' })).toBe(
      authFingerprint(base)
    );
    expect(authFingerprint({ ...base, tokenStorage: 'local' })).toBe(authFingerprint(base));
    expect(authFingerprint({ ...base, redactSecrets: false })).toBe(authFingerprint(base));
  });

  it('reflects only the presence of a secret, never its value', () => {
    // The fingerprint is shown in the UI and included in exports, so it must
    // not become a way to confirm or leak a secret.
    const withA = authFingerprint({ ...base, clientSecret: 'aaaaaa' });
    const withB = authFingerprint({ ...base, clientSecret: 'bbbbbb' });
    const without = authFingerprint({ ...base, clientSecret: '' });

    expect(withA).toBe(withB);
    expect(withA).not.toBe(without);
    expect(withA).not.toContain('aaaaaa');
  });

  it('drives configEquivalentForAuth', () => {
    expect(configEquivalentForAuth(base, { ...base, fhirBaseUrl: 'https://x.example' })).toBe(true);
    expect(configEquivalentForAuth(base, { ...base, clientId: 'x' })).toBe(false);
  });
});

describe('deriveRedirectUri', () => {
  it('appends /callback to the origin', () => {
    expect(deriveRedirectUri('http://localhost:4200')).toBe('http://localhost:4200/callback');
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(deriveRedirectUri('http://localhost:4200/')).toBe('http://localhost:4200/callback');
  });
});
