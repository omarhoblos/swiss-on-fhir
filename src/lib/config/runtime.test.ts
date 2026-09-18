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
import { loadRuntimeConfig, parseRuntimeObject } from './runtime';

function jsonResponse(body: string, init: { status?: number; statusText?: string } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('loadRuntimeConfig', () => {
  it('loads a well-formed file', async () => {
    const result = await loadRuntimeConfig(async () =>
      jsonResponse(
        JSON.stringify({
          fhirBaseUrl: 'https://fhir.example/baseR4',
          authIssuer: 'https://idp.example',
          clientId: 'swiss',
          clientSecret: '',
          scopes: 'openid fhirUser',
          skipIssuerCheck: 'false'
        })
      )
    );

    expect(result.loadError).toBeNull();
    expect(result.layer).toEqual({
      fhirBaseUrl: 'https://fhir.example/baseR4',
      authIssuer: 'https://idp.example',
      clientId: 'swiss',
      clientSecret: '',
      scopes: 'openid fhirUser',
      skipIssuerCheck: false
    });
  });

  it('reports HTML as a missing file rather than a JSON syntax error', async () => {
    // The realistic failure: env.json does not exist, so nginx's SPA
    // fallback serves index.html and we get a page instead of config.
    const result = await loadRuntimeConfig(async () =>
      jsonResponse('<!doctype html>\n<html><body>app</body></html>')
    );
    expect(result.loadError).toContain('HTML page');
    expect(result.loadError).toContain('SPA fallback');
  });

  it('reports malformed JSON without throwing', async () => {
    const result = await loadRuntimeConfig(async () => jsonResponse('{ "clientId": '));
    expect(result.loadError).toContain('not valid JSON');
    expect(result.layer).toEqual({});
  });

  it('rejects a JSON array', async () => {
    const result = await loadRuntimeConfig(async () => jsonResponse('[]'));
    expect(result.loadError).toContain('must contain a JSON object');
  });

  it('reports a non-200 status', async () => {
    const result = await loadRuntimeConfig(async () =>
      jsonResponse('not found', { status: 404, statusText: 'Not Found' })
    );
    expect(result.loadError).toContain('404');
  });

  it('reports a network failure without throwing', async () => {
    const result = await loadRuntimeConfig(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(result.loadError).toContain('Failed to fetch');
  });

  it('requests the file with cache disabled', async () => {
    // Without no-store the browser caches env.json and "edit .env, restart
    // the container, refresh" silently keeps serving the old values.
    let seen: RequestInit | undefined;
    await loadRuntimeConfig(async (_url, init) => {
      seen = init;
      return jsonResponse('{}');
    });
    expect(seen?.cache).toBe('no-store');
  });
});

describe('parseRuntimeObject', () => {
  it('drops empty values for fields where empty means unset', () => {
    // envsubst renders every unset variable as "". An unset FHIRENDPOINT_URI
    // must fall through to the default, not blank it out.
    const { layer } = parseRuntimeObject({ fhirBaseUrl: '', authIssuer: '', clientId: '' });
    expect(layer).toEqual({});
  });

  it('keeps an empty client secret, because empty means "public client"', () => {
    const { layer } = parseRuntimeObject({ clientSecret: '' });
    expect(layer).toEqual({ clientSecret: '' });
  });

  it('notes each key removed in 3.0 and still loads', () => {
    const { layer, issues, loadError } = parseRuntimeObject({
      clientId: 'swiss',
      redirectUri: 'http://localhost:4200/index.html',
      logoutUri: 'http://localhost:9200/logout',
      requireHttps: 'false',
      strictDiscoveryDocumentValidation: 'true'
    });

    expect(loadError).toBeNull();
    expect(layer).toEqual({ clientId: 'swiss' });

    const ignored = issues.filter((i) => i.ignoredKey).map((i) => i.ignoredKey);
    expect(ignored).toEqual(
      expect.arrayContaining([
        'redirectUri',
        'logoutUri',
        'requireHttps',
        'strictDiscoveryDocumentValidation'
      ])
    );
    // Informational only: every existing deployment has these in its .env,
    // so an upgrade must not fail on them.
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    for (const issue of issues.filter((i) => i.ignoredKey)) {
      expect(issue.message.toLowerCase()).toContain('safe to delete');
    }
  });

  it('accepts the v2 key names as aliases', () => {
    const { layer } = parseRuntimeObject({
      fhirEndpointUri: 'https://fhir.example',
      issuer: 'https://idp.example'
    });
    expect(layer.fhirBaseUrl).toBe('https://fhir.example');
    expect(layer.authIssuer).toBe('https://idp.example');
  });

  it('warns about an unknown key without failing', () => {
    const { layer, issues, loadError } = parseRuntimeObject({ clientId: 'x', somethingElse: 'y' });
    expect(loadError).toBeNull();
    expect(layer).toEqual({ clientId: 'x' });
    expect(issues.some((i) => i.ignoredKey === 'somethingElse')).toBe(true);
  });

  it('records a per-field error for an uncoercible value and keeps the rest', () => {
    const { layer, issues } = parseRuntimeObject({
      clientId: 'swiss',
      authIssuer: 'not-a-url',
      skipIssuerCheck: '${SKIP_ISSUER_CHECK}'
    });

    expect(layer).toEqual({ clientId: 'swiss' });
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.message.includes('envsubst'))).toBe(true);
  });

  it('ignores a $schema pointer', () => {
    const { layer, issues } = parseRuntimeObject({ $schema: './env.schema.json', clientId: 'x' });
    expect(layer).toEqual({ clientId: 'x' });
    expect(issues.some((i) => i.ignoredKey === '$schema')).toBe(false);
  });
});

describe('URL normalisation reporting', () => {
  it('warns when the issuer host was lowercased', () => {
    // This is the skipIssuerCheck footgun: `new URL()` lowercases the host,
    // so the value we send no longer matches what the server declares. It can
    // only be detected here, where the raw string still exists -- by the time
    // a value reaches cross-field validation the casing is already gone.
    const { layer, issues } = parseRuntimeObject({ authIssuer: 'https://IdP.Example' });

    expect(layer.authIssuer).toBe('https://idp.example');
    const warning = issues.find((i) => i.severity === 'warning');
    expect(warning?.message).toContain('lowercased');
    expect(warning?.message).toContain('issuer-match');
  });

  it('reports a removed trailing slash as informational only', () => {
    const { layer, issues } = parseRuntimeObject({ fhirBaseUrl: 'https://fhir.example/baseR4/' });
    expect(layer.fhirBaseUrl).toBe('https://fhir.example/baseR4');
    expect(issues.some((i) => i.message.includes('trailing slash'))).toBe(true);
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('says nothing when no normalisation happened', () => {
    const { issues } = parseRuntimeObject({ fhirBaseUrl: 'https://fhir.example/baseR4' });
    expect(issues).toEqual([]);
  });
});
