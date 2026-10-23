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
import { loadDeploymentEnvironments, slugOf } from './deployment';

function serving(body: string, init: { status?: number; type?: string } = {}): typeof fetch {
  return (async () =>
    new Response(body, {
      status: init.status ?? 200,
      headers: { 'content-type': init.type ?? 'application/json' }
    })) as typeof fetch;
}

const file = (environments: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ swissEnvironmentsVersion: 1, environments, ...extra });

describe('loadDeploymentEnvironments', () => {
  it('finds none, silently, behind a 404 or an HTML page', async () => {
    for (const fetchImpl of [
      serving('not here', { status: 404, type: 'text/plain' }),
      serving('<!doctype html><html></html>', { type: 'text/html' }),
      // A server that labels its fallback page wrongly.
      serving('<!doctype html><html></html>', { type: 'application/json' })
    ]) {
      expect(await loadDeploymentEnvironments(fetchImpl)).toEqual({
        present: false,
        environments: [],
        issues: []
      });
    }
  });

  it('finds none when the request fails, and reports another error status', async () => {
    const failing = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    expect((await loadDeploymentEnvironments(failing)).issues).toEqual([]);
    const broken = await loadDeploymentEnvironments(serving('', { status: 500 }));
    expect(broken.issues.join(' ')).toMatch(/HTTP 500/);
  });

  it('loads environments under deploy: ids, from their ids or their names', async () => {
    const result = await loadDeploymentEnvironments(
      serving(
        file([
          { id: 'partner', name: 'Partner sandbox', settings: { fhirBaseUrl: 'https://p.test' } },
          { name: 'EU Staging (blue)', settings: { clientId: 'eu' } }
        ])
      )
    );
    expect(result.present).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.environments.map((e) => e.id)).toEqual([
      'deploy:partner',
      'deploy:eu-staging-blue'
    ]);
    expect(result.environments[0]?.layer.fhirBaseUrl).toBe('https://p.test');
  });

  it('reports a file it cannot use, and an entry it skips, and loads the rest', async () => {
    const invalid = await loadDeploymentEnvironments(serving('{not json'));
    expect(invalid.present).toBe(true);
    expect(invalid.issues.join(' ')).toMatch(/Not valid JSON/);

    const mixed = await loadDeploymentEnvironments(
      serving(
        file([
          { name: 'Broken', settings: { fhirBaseUrl: 'ftp://x' } },
          { name: 'Same' },
          { name: 'same' },
          { name: 'Kept' }
        ])
      )
    );
    expect(mixed.environments.map((e) => e.name)).toEqual(['Same', 'Kept']);
    expect(mixed.issues.join(' ')).toMatch(/“Broken”.*was not loaded/);
    expect(mixed.issues.join(' ')).toMatch(/deploy:same.*already used/);
  });

  it('says that a single configuration belongs in .env', async () => {
    const result = await loadDeploymentEnvironments(serving('{"clientId": "x"}'));
    expect(result.environments).toEqual([]);
    expect(result.issues.join(' ')).toMatch(/use \.env/);
  });

  it('turns defaultEnvironment into its deploy: id', async () => {
    const result = await loadDeploymentEnvironments(
      serving(
        file(
          [
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' }
          ],
          { defaultEnvironment: 'b' }
        )
      )
    );
    expect(result.defaultEnvironment).toBe('deploy:b');
  });

  it('carries a key along for the key store, never into the settings', async () => {
    const result = await loadDeploymentEnvironments(
      serving(file([{ name: 'K', backendServicesKey: '-----BEGIN PRIVATE KEY-----\nx' }]))
    );
    expect(result.environments[0]?.key?.kind).toBe('pem');
    expect(JSON.stringify(result.environments[0]?.layer)).not.toContain('PRIVATE');
  });
});

describe('slugOf', () => {
  it('makes an id from a name', () => {
    expect(slugOf('  EU Staging (blue) ')).toBe('eu-staging-blue');
    expect(slugOf('Café prod')).toBe('cafe-prod');
    expect(slugOf('***')).toBe('');
  });
});
