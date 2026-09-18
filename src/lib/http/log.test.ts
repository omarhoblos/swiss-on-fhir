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
import { dedupeById, redactExchange, REDACTED, toCurl, type HttpExchange } from './exchange';

/**
 * The log is a Svelte runes store, so its reactive surface is covered by the
 * e2e specs. What is unit-tested here is the part that must not regress:
 * nothing with a live credential in it may be handed out unredacted, since
 * the redacted form is what gets persisted to disk and downloaded.
 */
function exchangeWithSecrets(): HttpExchange {
  return {
    id: 'x1',
    label: 'Token exchange',
    startedAt: 1_700_000_000_000,
    durationMs: 42,
    request: {
      method: 'POST',
      url: 'https://idp.test/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic c3dpc3M6aHVudGVyMg=='
      },
      body: 'grant_type=authorization_code&code=THE_CODE&code_verifier=THE_VERIFIER&client_secret=hunter2'
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      type: 'cors',
      body: JSON.stringify({
        access_token: 'THE_ACCESS_TOKEN',
        refresh_token: 'THE_REFRESH_TOKEN',
        id_token: 'THE_ID_TOKEN',
        token_type: 'Bearer'
      })
    },
    outcome: 'ok',
    redactions: []
  };
}

describe('redactExchange', () => {
  it('masks every credential that would otherwise reach disk', () => {
    const serialised = JSON.stringify(redactExchange(exchangeWithSecrets()));

    for (const secret of [
      'c3dpc3M6aHVudGVyMg==', // the Basic credential
      'THE_VERIFIER',
      'hunter2',
      'THE_CODE',
      'THE_ACCESS_TOKEN',
      'THE_REFRESH_TOKEN',
      'THE_ID_TOKEN'
    ]) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret);
    }
    expect(serialised).toContain(REDACTED);
  });

  it('names what it masked, so an export is honest rather than silently lossy', () => {
    const redacted = redactExchange(exchangeWithSecrets());
    expect(redacted.redactions).toContain('request header Authorization');
    expect(redacted.redactions).toEqual(
      expect.arrayContaining([
        'request body client_secret',
        'request body code_verifier',
        'request body code',
        'response body access_token',
        'response body refresh_token',
        'response body id_token'
      ])
    );
  });

  it('leaves non-sensitive detail intact, so the log stays useful', () => {
    const redacted = redactExchange(exchangeWithSecrets());
    expect(redacted.request.url).toBe('https://idp.test/token');
    expect(redacted.request.method).toBe('POST');
    expect(redacted.request.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(redacted.request.body).toContain('grant_type=authorization_code');
    expect(redacted.response?.status).toBe(200);
    expect(redacted.durationMs).toBe(42);
  });

  it('does not mutate the original', () => {
    const original = exchangeWithSecrets();
    redactExchange(original);
    expect(original.request.headers.Authorization).toBe('Basic c3dpc3M6aHVudGVyMg==');
    expect(original.redactions).toEqual([]);
  });

  it('handles an exchange with no response or body', () => {
    const minimal: HttpExchange = {
      id: 'x2',
      label: 'Probe',
      startedAt: 0,
      durationMs: 0,
      request: { method: 'GET', url: 'https://fhir.test/metadata', headers: {} },
      outcome: 'network-or-cors',
      redactions: []
    };
    expect(() => redactExchange(minimal)).not.toThrow();
    expect(redactExchange(minimal).redactions).toEqual([]);
  });
});

describe('toCurl', () => {
  it('includes the Origin header, which is what makes it useful for CORS', () => {
    const curl = toCurl(redactExchange(exchangeWithSecrets()), 'http://localhost:4200');
    expect(curl).toContain("-H 'Origin: http://localhost:4200'");
    expect(curl).toContain('-X POST');
    expect(curl).toContain('https://idp.test/token');
  });

  it('reproduces a redacted exchange without leaking the credential', () => {
    const curl = toCurl(redactExchange(exchangeWithSecrets()), 'http://localhost:4200');
    expect(curl).not.toContain('hunter2');
    expect(curl).toContain(REDACTED);
  });

  it('escapes single quotes in a body so the command stays valid', () => {
    const exchange = exchangeWithSecrets();
    exchange.request.body = "note=it's fine";
    const curl = toCurl(exchange, 'http://localhost:4200');
    expect(curl).toContain("'\\''");
  });
});

describe('dedupeById', () => {
  /**
   * Regression test for the log drawer refusing to open. Exchange ids used to
   * come from a module counter that restarted at 0 on every page load, so the
   * first request after a reload was `x1` again and collided with the `x1`
   * restored from IndexedDB. The drawer keys its {#each} by id, and Svelte
   * throws `each_key_duplicate` on a repeat, which aborted the render of the
   * panel -- the drawer toggled its state and then showed nothing.
   *
   * Ids are now unique per page view, but records written by earlier builds
   * are already on disk with repeats in them, so the merge still has to heal
   * them or those users stay broken until they clear site storage.
   */
  function entry(id: string, url: string): HttpExchange {
    return {
      id,
      label: 'probe',
      startedAt: 0,
      durationMs: 1,
      request: { method: 'GET', url, headers: {} },
      outcome: 'ok',
      redactions: []
    };
  }

  it('drops a repeated id and keeps the first, which is the newer entry', () => {
    const merged = dedupeById([
      entry('x1', 'https://new.test/a'),
      entry('x1', 'https://restored.test/a'),
      entry('x2', 'https://restored.test/b')
    ]);

    expect(merged.map((e) => e.id)).toEqual(['x1', 'x2']);
    expect(merged[0]?.request.url).toBe('https://new.test/a');
  });

  it('leaves a log with distinct ids untouched', () => {
    const entries = [entry('a', 'https://x.test/1'), entry('b', 'https://x.test/2')];
    expect(dedupeById(entries)).toEqual(entries);
  });

  it('handles an empty log', () => {
    expect(dedupeById([])).toEqual([]);
  });
});
