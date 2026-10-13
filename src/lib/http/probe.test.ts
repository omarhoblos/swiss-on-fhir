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
import { anySignal, preflightTriggers, probe } from './probe';

/**
 * The request path, against fake servers. Each fake honours the signal it is
 * given, the way the browser's fetch does, so what is under test is which
 * signal probe hands over and what it makes of the outcome.
 */

/** A server that takes the request and never answers. */
function silent(calls: RequestInit[] = []): typeof fetch {
  return ((_url: string, init: RequestInit = {}) => {
    calls.push(init);
    return new Promise((_resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }) as typeof fetch;
}

/** Refuses the CORS request at once, then leaves the no-cors follow-up hanging. */
function refusedThenSilent(calls: RequestInit[] = []): typeof fetch {
  const hang = silent();
  return ((url: string, init: RequestInit = {}) => {
    calls.push(init);
    if (init.mode === 'no-cors') return hang(url, init);
    return Promise.reject(new TypeError('Failed to fetch'));
  }) as typeof fetch;
}

/** Sends headers, then a body that never finishes. */
function stalledBody(): typeof fetch {
  return ((_url: string, init: RequestInit = {}) =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      type: 'cors',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () =>
        new Promise<string>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true
          });
        })
    } as unknown as Response)) as typeof fetch;
}

const URL_ = 'https://fhir.test/.well-known/smart-configuration';
const base = { label: 'test', pageOrigin: 'http://localhost:4200' };

describe('probe: stopping a request', () => {
  it('reports a cancelled request as aborted, with no diagnosis and no follow-up', async () => {
    const calls: RequestInit[] = [];
    const controller = new AbortController();
    const pending = probe(URL_, {
      ...base,
      fetchImpl: silent(calls),
      signal: controller.signal
    });
    controller.abort();
    const { exchange } = await pending;

    expect(exchange.outcome).toBe('aborted');
    expect(exchange.diagnosis).toBeUndefined();
    // No no-cors request sent to "investigate" a click on Stop.
    expect(calls).toHaveLength(1);
  });

  it('keeps its timeout when the caller also passes a signal', async () => {
    // Passing a signal used to replace the timeout, so this never ended.
    const started = Date.now();
    const { exchange } = await probe(URL_, {
      ...base,
      fetchImpl: silent(),
      signal: new AbortController().signal,
      timeoutMs: 50
    });

    expect(exchange.outcome).toBe('timeout');
    expect(exchange.diagnosis?.likelyCause).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('times out on its own when no signal is passed', async () => {
    const { exchange } = await probe(URL_, { ...base, fetchImpl: silent(), timeoutMs: 50 });
    expect(exchange.outcome).toBe('timeout');
  });

  it('bounds the follow-up request after a refusal, and says what it could not tell', async () => {
    // The no-cors follow-up had no limit at all.
    const calls: RequestInit[] = [];
    const started = Date.now();
    const { exchange } = await probe(URL_, {
      ...base,
      fetchImpl: refusedThenSilent(calls),
      timeoutMs: 50
    });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(calls.map((c) => c.mode)).toEqual(['cors', 'no-cors']);
    expect(calls[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(exchange.outcome).toBe('network-or-cors');
    expect(exchange.diagnosis?.likelyCause).toBe('unknown');
    expect(exchange.diagnosis?.evidence.join(' ')).toMatch(/got no answer within 50ms/);
  });

  it('stops the follow-up request too, and then reports the request as aborted', async () => {
    const calls: RequestInit[] = [];
    const controller = new AbortController();
    const pending = probe(URL_, {
      ...base,
      fetchImpl: refusedThenSilent(calls),
      signal: controller.signal
    });
    // Let the first request fail and the follow-up start.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(2);
    controller.abort();
    const { exchange } = await pending;

    expect(exchange.outcome).toBe('aborted');
    expect(exchange.diagnosis).toBeUndefined();
  });

  it('times out a body that stops arriving', async () => {
    const { exchange } = await probe(URL_, { ...base, fetchImpl: stalledBody(), timeoutMs: 50 });
    expect(exchange.outcome).toBe('timeout');
    expect(exchange.diagnosis?.evidence[0]).toMatch(/body did not finish/);
  });

  it('reports a body cut short by the caller as aborted', async () => {
    const controller = new AbortController();
    const pending = probe(URL_, { ...base, fetchImpl: stalledBody(), signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    expect((await pending).exchange.outcome).toBe('aborted');
  });

  it('still diagnoses a refusal when the follow-up answers', async () => {
    const fetchImpl = ((_url: string, init: RequestInit = {}) =>
      init.mode === 'no-cors'
        ? Promise.resolve(new Response(null, { status: 200 }))
        : Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    const { exchange } = await probe(URL_, { ...base, fetchImpl });
    expect(exchange.outcome).toBe('network-or-cors');
    expect(exchange.diagnosis?.likelyCause).toBe('cors-missing-acao');
  });
});

/** Reachable, but the page may not read the answer: what a CORS refusal looks like. */
const refusedButReachable = ((_url: string, init: RequestInit = {}) =>
  init.mode === 'no-cors'
    ? Promise.resolve(new Response(null, { status: 200 }))
    : Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;

describe('probe: telling a preflight failure from a missing origin header', () => {
  const TOKEN = 'https://idp.test/token';
  const form = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const diagnose = async (options: { method?: string; headers?: Record<string, string> }) =>
    (await probe(TOKEN, { ...base, fetchImpl: refusedButReachable, ...options })).exchange
      .diagnosis!;

  it('does not blame a preflight for a token request, which is never preflighted', async () => {
    // A public client's code exchange, refresh and revoke, and the Diagnostics
    // token endpoint probe: a form POST with an Accept header.
    const diagnosis = await diagnose({ method: 'POST', headers: form });
    expect(diagnosis.likelyCause).toBe('cors-missing-acao');
    expect(diagnosis.remediationIds).toEqual(['cors-missing-acao']);
    expect(diagnosis.evidence.join(' ')).not.toMatch(/preflight/);
  });

  it('blames the preflight when the request carries an Authorization header', async () => {
    const diagnosis = await diagnose({
      method: 'POST',
      headers: { ...form, Authorization: 'Basic c2VjcmV0' }
    });
    expect(diagnosis.likelyCause).toBe('cors-preflight');
    expect(diagnosis.remediationIds).toEqual(['cors-preflight-authorization']);
    // Names what forced the preflight, not every header, and never a value.
    const evidence = diagnosis.evidence.join(' ');
    expect(evidence).toContain(
      'carried Authorization, which forces a CORS preflight. The server must answer OPTIONS without authentication and list that header in Access-Control-Allow-Headers.'
    );
    expect(evidence).not.toMatch(/Accept|Content-Type|c2VjcmV0/);
  });

  it('blames the preflight for a FHIR content type, naming it', async () => {
    const diagnosis = await diagnose({
      method: 'POST',
      headers: {
        'Content-Type': 'application/fhir+json; charset=utf-8',
        Accept: 'application/fhir+json'
      }
    });
    expect(diagnosis.likelyCause).toBe('cors-preflight');
    expect(diagnosis.evidence.join(' ')).toContain('carried Content-Type: application/fhir+json,');
  });

  it('blames the preflight for a method that is not simple, and says which list to fix', async () => {
    const diagnosis = await diagnose({
      method: 'DELETE',
      headers: { Accept: 'application/fhir+json' }
    });
    expect(diagnosis.likelyCause).toBe('cors-preflight');
    const evidence = diagnosis.evidence.join(' ');
    expect(evidence).toContain(
      'used the DELETE method, which forces a CORS preflight. The server must answer OPTIONS without authentication and list DELETE in Access-Control-Allow-Methods.'
    );
    expect(evidence).not.toMatch(/Allow-Headers/);
  });

  it('names both the method and the headers when both force it', async () => {
    const diagnosis = await diagnose({
      method: 'PUT',
      headers: {
        Authorization: 'Bearer t',
        'Content-Type': 'application/fhir+json',
        'If-Match': 'W/"1"'
      }
    });
    expect(diagnosis.evidence.join(' ')).toContain(
      'used the PUT method and carried Authorization, Content-Type: application/fhir+json, If-Match, which forces a CORS preflight. The server must answer OPTIONS without authentication and list PUT in Access-Control-Allow-Methods and list those headers in Access-Control-Allow-Headers.'
    );
  });
});

describe('preflightTriggers', () => {
  it('finds nothing in a simple request', () => {
    const none = { method: null, headers: [] };
    expect(preflightTriggers('GET')).toEqual(none);
    expect(preflightTriggers('get', { accept: 'application/fhir+json' })).toEqual(none);
    expect(
      preflightTriggers('HEAD', { 'Accept-Language': 'en', 'Content-Language': 'en' })
    ).toEqual(none);
    for (const type of [
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'TEXT/PLAIN; charset=utf-8'
    ]) {
      expect(preflightTriggers('POST', { 'Content-Type': type })).toEqual(none);
    }
    expect(preflightTriggers('GET', { Range: 'bytes=0-99' })).toEqual(none);
  });

  it('finds a method other than GET, HEAD and POST', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(preflightTriggers(method).method).toBe(method);
    }
    expect(preflightTriggers('delete').method).toBe('DELETE');
  });

  it('finds every header that is not safelisted, by name only', () => {
    expect(
      preflightTriggers('GET', {
        Accept: 'application/fhir+json',
        Authorization: 'Bearer secret',
        Prefer: 'return=minimal',
        'X-Api-Key': 'k'
      }).headers
    ).toEqual(['Authorization', 'Prefer', 'X-Api-Key']);
  });

  it('finds a content type that is not a form or plain text, and a range that is not simple', () => {
    expect(preflightTriggers('POST', { 'content-type': 'application/json' }).headers).toEqual([
      'content-type: application/json'
    ]);
    expect(preflightTriggers('GET', { Range: 'bytes=0-9, 20-29' }).headers).toEqual(['Range']);
  });

  it('finds a safelisted header whose value is over the limit', () => {
    expect(preflightTriggers('GET', { Accept: 'a'.repeat(128) }).headers).toEqual([]);
    expect(preflightTriggers('GET', { Accept: 'a'.repeat(129) }).headers).toEqual([
      'Accept (over 128 bytes)'
    ]);
  });
});

describe('anySignal', () => {
  it('aborts when any of its signals does, with that reason', () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = anySignal([a.signal, b.signal]);
    expect(combined.aborted).toBe(false);
    b.abort('stopped');
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('stopped');
  });

  it('is aborted from the start when one of its signals already is', () => {
    const a = new AbortController();
    a.abort();
    expect(anySignal([a.signal, new AbortController().signal]).aborted).toBe(true);
  });

  it('works without AbortSignal.any, for older browsers', () => {
    const original = AbortSignal.any;
    // @ts-expect-error -- simulating a browser that predates it
    AbortSignal.any = undefined;
    try {
      const a = new AbortController();
      const combined = anySignal([a.signal, new AbortController().signal]);
      a.abort('gone');
      expect(combined.aborted).toBe(true);
      expect(combined.reason).toBe('gone');
    } finally {
      AbortSignal.any = original;
    }
  });
});
