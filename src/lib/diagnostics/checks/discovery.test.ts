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
import { coerceUrl } from '#lib/config/coerce.ts';
import { DEFAULTS } from '#lib/config/defaults.ts';
import { discoveryChecks, issuerMatchesConfigured } from './discovery';
import type { DiagnosticsContext } from '../types';
import type { DiscoveryDocuments } from '#lib/smart/discovery.ts';

const issParameter = discoveryChecks.find((check) => check.id === 'disc.iss-parameter');
const openidConfiguration = discoveryChecks.find(
  (check) => check.id === 'disc.openid-configuration'
);

function context(docs: DiscoveryDocuments): DiagnosticsContext {
  return {
    config: { ...DEFAULTS },
    origin: 'http://localhost:4200',
    endpoints: {},
    docs,
    gates: null,
    documentUrls: {},
    session: null
  };
}

describe('disc.iss-parameter', () => {
  it('is registered after the OpenID configuration check it depends on', () => {
    expect(issParameter).toBeDefined();
    expect(issParameter!.dependsOn).toContain('disc.openid-configuration');
  });

  it('passes when the server advertises RFC 9207', async () => {
    const outcome = await issParameter!.run(
      context({ 'openid-configuration': { authorization_response_iss_parameter_supported: true } })
    );
    expect(outcome.status).toBe('pass');
    expect(outcome.spec?.url).toBe('https://www.rfc-editor.org/rfc/rfc9207');
  });

  it('warns, without failing, when it is absent', async () => {
    const outcome = await issParameter!.run(context({ 'openid-configuration': {} }));
    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('mix-up');
    // Reading documents already in hand makes no requests.
    expect(outcome.exchanges).toEqual([]);
  });

  // "Does not advertise an iss parameter" read as "no issuer found".
  it('says the declared issuer is fine and names the missing flag', async () => {
    const outcome = await issParameter!.run(
      context({ 'openid-configuration': { issuer: 'http://localhost:9200' } })
    );
    expect(outcome.summary).toBe(
      'The issuer itself is declared. Only the RFC 9207 flag, `authorization_response_iss_parameter_supported`, is missing.'
    );
    expect(outcome.detail).toContain('the server declares `http://localhost:9200`');
    expect(outcome.detail).toContain('"authorization_response_iss_parameter_supported": true');
  });

  it('does not claim an issuer is declared when none is', async () => {
    const outcome = await issParameter!.run(context({ 'openid-configuration': {} }));
    expect(outcome.summary).not.toContain('issuer itself is declared');
    expect(outcome.summary).toContain('`authorization_response_iss_parameter_supported`');
  });

  it('finds the issuer in smart-configuration when OpenID configuration has none', async () => {
    const outcome = await issParameter!.run(
      context({ 'smart-configuration': { issuer: 'https://idp.test' } })
    );
    expect(outcome.detail).toContain('the server declares `https://idp.test`');
  });
});

describe('disc.openid-configuration', () => {
  // As the config layer stores it: `coerceUrl` strips a trailing slash.
  const configured = 'https://idp.test/test/a/swiss';

  /** Serves an openid-configuration declaring `issuer`, and records what was fetched. */
  function serving(issuer: string) {
    const fetched: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return new Response(JSON.stringify({ issuer }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;
    const ctx: DiagnosticsContext = {
      ...context({}),
      config: { ...DEFAULTS, authIssuer: configured },
      fetchImpl
    };
    return { ctx, fetched };
  }

  it('passes when the declared issuer is the configured one', async () => {
    const { ctx, fetched } = serving(configured);
    const outcome = await openidConfiguration!.run(ctx);
    expect(outcome.status).toBe('pass');
    expect(fetched).toEqual([`${configured}/.well-known/openid-configuration`]);
  });

  it('passes when the declared issuer ends in the slash the configuration strips', async () => {
    // Discovery 4.1 removes the terminating slash before appending the
    // well-known path, so `…/swiss/` is fetched from `…/swiss/.well-known/…`.
    const { ctx, fetched } = serving(`${configured}/`);
    const outcome = await openidConfiguration!.run(ctx);
    expect(outcome.status).toBe('pass');
    expect(outcome.remediations ?? []).toEqual([]);
    expect(outcome.detail).toContain(`${configured}/`);
    expect(fetched).toEqual([`${configured}/.well-known/openid-configuration`]);
  });

  it('fails on a different path, and offers to adopt it', async () => {
    const declared = 'https://idp.test/test/a/other';
    const outcome = await openidConfiguration!.run(serving(declared).ctx);
    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('substantive');
    expect(outcome.remediations?.[0]?.actions).toEqual([
      expect.objectContaining({ kind: 'set-config', patch: { authIssuer: declared } })
    ]);
  });

  it('offers a button that clears the failure once saved through the config parser', async () => {
    // The declared issuer ends in a slash, which saving strips again.
    const declared = 'https://idp.test/test/a/other/';
    const before = await openidConfiguration!.run(serving(declared).ctx);
    expect(before.status).toBe('fail');
    const patch = before.remediations?.[0]?.actions?.[0]?.patch;
    expect(patch).toEqual({ authIssuer: declared });

    const saved = coerceUrl(patch!.authIssuer);
    expect(saved).toEqual({ ok: true, value: 'https://idp.test/test/a/other' });
    const { ctx } = serving(declared);
    const after = await openidConfiguration!.run({
      ...ctx,
      config: { ...ctx.config, authIssuer: saved.ok ? saved.value : '' }
    });
    expect(after.status).toBe('pass');
  });

  it('fails on a different host', async () => {
    const outcome = await openidConfiguration!.run(serving('https://other.test/test/a/swiss/').ctx);
    expect(outcome.status).toBe('fail');
  });

  it('fails on a second trailing slash, with no button that could not clear it', async () => {
    const outcome = await openidConfiguration!.run(serving(`${configured}//`).ctx);
    expect(outcome.status).toBe('fail');
    expect(outcome.remediations?.[0]?.actions ?? []).toEqual([]);
  });

  it('offers no button for a mixed-case host, which saving would lowercase', async () => {
    const outcome = await openidConfiguration!.run(serving('https://IdP.test/test/a/swiss').ctx);
    expect(outcome.status).toBe('fail');
    expect(outcome.remediations?.[0]?.actions ?? []).toEqual([]);
  });
});

describe('issuerMatchesConfigured', () => {
  it('accepts the same string, with or without one terminating slash', () => {
    expect(issuerMatchesConfigured('https://idp.test/a', 'https://idp.test/a')).toBe(true);
    expect(issuerMatchesConfigured('https://idp.test/a/', 'https://idp.test/a')).toBe(true);
    expect(issuerMatchesConfigured('https://idp.test/', 'https://idp.test')).toBe(true);
  });

  it('rejects any other difference', () => {
    expect(issuerMatchesConfigured('https://idp.test/a//', 'https://idp.test/a')).toBe(false);
    expect(issuerMatchesConfigured('https://idp.test/A', 'https://idp.test/a')).toBe(false);
    expect(issuerMatchesConfigured('https://other.test/a/', 'https://idp.test/a')).toBe(false);
    expect(issuerMatchesConfigured('/', '')).toBe(false);
  });
});
