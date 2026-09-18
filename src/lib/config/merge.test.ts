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
import { DEFAULTS } from './defaults';
import {
  authFingerprint,
  configEquivalentForAuth,
  deriveRedirectUri,
  mergeDefined,
  resolveSources,
  snapshotConfig
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

describe('snapshotConfig', () => {
  const withSecret: AppConfig = { ...DEFAULTS, clientSecret: 'hunter2' };

  it('removes the secret value but records that one was set', () => {
    // The snapshot is persisted to web storage alongside every transaction
    // and session, so carrying the secret would write it to storage twice
    // more than necessary on top of its own dedicated slot.
    const snapshot = snapshotConfig(withSecret);

    expect('clientSecret' in snapshot).toBe(false);
    expect(snapshot.hasClientSecret).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('hunter2');
  });

  it('records the absence of a secret', () => {
    expect(snapshotConfig({ ...DEFAULTS, clientSecret: '' }).hasClientSecret).toBe(false);
  });

  it('keeps every other auth-critical field', () => {
    const snapshot = snapshotConfig(withSecret);
    expect(snapshot.authIssuer).toBe(DEFAULTS.authIssuer);
    expect(snapshot.clientId).toBe(DEFAULTS.clientId);
    expect(snapshot.scopes).toBe(DEFAULTS.scopes);
    expect(snapshot.clientAuthMethod).toBe(DEFAULTS.clientAuthMethod);
  });

  it('fingerprints identically to the config it came from', () => {
    // Otherwise every session would look stale the moment it was stored.
    expect(authFingerprint(snapshotConfig(withSecret))).toBe(authFingerprint(withSecret));
    expect(configEquivalentForAuth(snapshotConfig(withSecret), withSecret)).toBe(true);
  });

  it('still detects a secret being added or removed', () => {
    const before = snapshotConfig({ ...DEFAULTS, clientSecret: '' });
    expect(configEquivalentForAuth(before, withSecret)).toBe(false);
  });

  it('does not treat a rotated secret as a config change', () => {
    const snapshot = snapshotConfig(withSecret);
    expect(configEquivalentForAuth(snapshot, { ...DEFAULTS, clientSecret: 'different' })).toBe(
      true
    );
  });
});
