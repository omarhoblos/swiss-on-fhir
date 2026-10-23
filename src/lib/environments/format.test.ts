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
import { DEFAULTS } from '#lib/config/defaults.ts';
import { MAX_ENVIRONMENTS } from '#lib/config/persist.ts';
import {
  ENVIRONMENTS_FORMAT_VERSION,
  MAX_ENVIRONMENTS_FILE_LENGTH,
  OMITTED,
  parseEnvironmentsFile,
  serializeEnvironments,
  type ExportEntry
} from './format';

const staging: ExportEntry = {
  id: 'env-staging01',
  name: 'Staging',
  origin: 'browser',
  config: {
    ...DEFAULTS,
    fhirBaseUrl: 'https://fhir.staging.test',
    clientId: 'staging-client',
    clientSecret: 's3cret',
    defaultLaunchType: 'backend-services',
    backendClientId: 'staging-backend'
  }
};

const fileWith = (environments: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ swissEnvironmentsVersion: 1, environments, ...extra });

describe('serializeEnvironments', () => {
  it('writes an array of environments even when there is only one', () => {
    const written = JSON.parse(serializeEnvironments([staging], { includeSecret: false }));
    expect(written.swissEnvironmentsVersion).toBe(ENVIRONMENTS_FORMAT_VERSION);
    expect(Array.isArray(written.environments)).toBe(true);
    expect(written.environments).toHaveLength(1);
    expect(written).not.toHaveProperty('swissConfigVersion');
  });

  it('leaves the client secret out unless asked, and never writes a private key', () => {
    const publicJwks = { keys: [{ kty: 'EC', crv: 'P-384', x: 'x', y: 'y', kid: 'k' }] };
    const without = JSON.parse(
      serializeEnvironments([{ ...staging, publicJwks }], { includeSecret: false })
    );
    const withSecret = JSON.parse(serializeEnvironments([staging], { includeSecret: true }));
    expect(without.environments[0].settings.clientSecret).toBe(OMITTED);
    expect(without.environments[0].publicJwks).toEqual(publicJwks);
    expect(JSON.stringify(without)).not.toMatch(/"d"\s*:/);
    expect(withSecret.environments[0].settings.clientSecret).toBe('s3cret');
  });
});

describe('parseEnvironmentsFile', () => {
  it('round-trips an export', () => {
    const parsed = parseEnvironmentsFile(serializeEnvironments([staging], { includeSecret: true }));
    expect(parsed.kind).toBe('environments');
    if (parsed.kind !== 'environments') return;
    const [env] = parsed.environments;
    expect(env?.name).toBe('Staging');
    expect(env?.errors).toEqual([]);
    expect(env?.layer).toMatchObject({
      fhirBaseUrl: 'https://fhir.staging.test',
      clientId: 'staging-client',
      clientSecret: 's3cret',
      defaultLaunchType: 'backend-services',
      backendClientId: 'staging-backend'
    });
  });

  it('skips an omitted secret and says so', () => {
    const parsed = parseEnvironmentsFile(
      serializeEnvironments([staging], { includeSecret: false })
    );
    if (parsed.kind !== 'environments') throw new Error(parsed.kind);
    expect(parsed.environments[0]?.layer).not.toHaveProperty('clientSecret');
    expect(parsed.environments[0]?.notes.join(' ')).toMatch(/client secret was left out/);
  });

  it('refuses one environment whole when a setting does not parse, and keeps the others', () => {
    const parsed = parseEnvironmentsFile(
      fileWith([
        { name: 'Broken', settings: { fhirBaseUrl: 'ftp://nope', clientId: 'kept?' } },
        { name: 'Fine', settings: { clientId: 'fine' } }
      ])
    );
    if (parsed.kind !== 'environments') throw new Error(parsed.kind);
    expect(parsed.environments[0]?.errors.length).toBeGreaterThan(0);
    expect(parsed.environments[1]?.errors).toEqual([]);
  });

  it('cleans names, ignores bad ids, and refuses a repeated id', () => {
    const parsed = parseEnvironmentsFile(
      fileWith([
        { id: 'one', name: ' A\nname ' },
        { id: 'Not An Id', name: '' },
        { id: 'one', name: 'Again' }
      ])
    );
    if (parsed.kind !== 'environments') throw new Error(parsed.kind);
    const [a, b, c] = parsed.environments;
    expect(a?.name).toBe('A name');
    expect(b?.id).toBeUndefined();
    expect(b?.name).toBe('Environment 2');
    expect(c?.errors.join(' ')).toMatch(/used by an earlier entry/);
  });

  it('carries a private key for import, as JWK or PEM, and refuses anything else', () => {
    const parsed = parseEnvironmentsFile(
      fileWith([
        { name: 'J', backendServicesKey: { kty: 'EC', crv: 'P-384', d: 'x' } },
        { name: 'P', backendServicesKey: '-----BEGIN PRIVATE KEY-----\nx' },
        { name: 'N', backendServicesKey: 42 }
      ])
    );
    if (parsed.kind !== 'environments') throw new Error(parsed.kind);
    expect(parsed.environments[0]?.key?.kind).toBe('jwk');
    expect(parsed.environments[1]?.key?.kind).toBe('pem');
    expect(parsed.environments[2]?.errors.join(' ')).toMatch(/JWK object or a PEM/);
  });

  it('caps the size of the file and the number of environments', () => {
    expect(parseEnvironmentsFile('x'.repeat(MAX_ENVIRONMENTS_FILE_LENGTH + 1)).kind).toBe(
      'invalid'
    );
    const parsed = parseEnvironmentsFile(
      fileWith(Array.from({ length: MAX_ENVIRONMENTS + 3 }, (_, i) => ({ name: `E${i}` })))
    );
    if (parsed.kind !== 'environments') throw new Error(parsed.kind);
    expect(parsed.environments).toHaveLength(MAX_ENVIRONMENTS);
    expect(parsed.notes.join(' ')).toMatch(/Only the first/);
  });

  it('keeps a defaultEnvironment only when it names an environment', () => {
    const named = parseEnvironmentsFile(
      fileWith([{ id: 'a', name: 'A' }], { defaultEnvironment: 'a' })
    );
    const unknown = parseEnvironmentsFile(
      fileWith([{ id: 'a', name: 'A' }], { defaultEnvironment: 'b' })
    );
    expect(named.kind === 'environments' && named.defaultEnvironment).toBe('a');
    expect(unknown.kind === 'environments' && unknown.defaultEnvironment).toBeUndefined();
  });

  it('reads a 3.1 export as one configuration for the environment in use', () => {
    const parsed = parseEnvironmentsFile(
      JSON.stringify({ swissConfigVersion: 1, clientId: 'old', clientSecret: OMITTED, nonsense: 1 })
    );
    expect(parsed.kind).toBe('single');
    if (parsed.kind !== 'single') return;
    expect(parsed.layer).toEqual({ clientId: 'old' });
    expect(parsed.errors).toEqual([]);
    expect(parsed.notes.join(' ')).toMatch(/nonsense/);
  });

  it('says what is wrong with a file it cannot use', () => {
    for (const [text, message] of [
      ['{not json', /Not valid JSON/],
      ['[]', /JSON object/],
      ['{"unrelated": true}', /No Swiss settings/],
      [JSON.stringify({ swissEnvironmentsVersion: 2, environments: [] }), /newer Swiss/],
      [JSON.stringify({ swissEnvironmentsVersion: 1, environments: {} }), /must be a list/]
    ] as const) {
      const parsed = parseEnvironmentsFile(text);
      expect(parsed.kind, text).toBe('invalid');
      expect(parsed.kind === 'invalid' && parsed.error, text).toMatch(message);
    }
  });
});
