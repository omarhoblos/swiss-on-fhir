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
import { DEFAULTS } from '$lib/config/defaults';
import { deriveFeatureGates } from '$lib/smart/capabilities';
import { capabilityChecks } from './capabilities';
import type { DiagnosticsContext, DiagnosticsSession } from '../types';

const grantTypes = capabilityChecks.find((check) => check.id === 'cap.grant-types');

function context(options: {
  grants?: string[];
  session?: DiagnosticsSession | null;
  scopes?: string;
}): DiagnosticsContext {
  return {
    config: { ...DEFAULTS, scopes: options.scopes ?? 'openid offline_access patient/*.read' },
    origin: 'http://localhost:4200',
    endpoints: {},
    docs: {},
    gates: deriveFeatureGates({
      authorization_endpoint: 'https://idp.test/authorize',
      token_endpoint: 'https://idp.test/token',
      ...(options.grants ? { grant_types_supported: options.grants } : {})
    }),
    documentUrls: {},
    session: options.session ?? null
  };
}

const withRefresh: DiagnosticsSession = { hasRefreshToken: true, staleConfig: false };

describe('cap.grant-types', () => {
  it('is registered', () => {
    expect(grantTypes).toBeDefined();
  });

  it('warns when offline_access is requested and refresh_token is not advertised', () => {
    return grantTypes!.run(context({ grants: ['authorization_code'] })).then((outcome) => {
      expect(outcome.status).toBe('warn');
      expect(outcome.detail).toContain('no way to renew it');
      expect(outcome.remediations.map((r) => r.id)).toContain('refresh-not-enabled');
    });
  });

  it('does not warn when the server actually issued a refresh token', async () => {
    /**
     * The reported bug: the check read only `grant_types_supported`, and the
     * diagnostics context hardcoded `session: null`, so a refresh token sitting
     * in the session could never be seen. Servers under-report their grants
     * constantly, and telling someone refresh is unavailable while they are
     * holding a refresh token is simply wrong.
     */
    const outcome = await grantTypes!.run(
      context({ grants: ['authorization_code'], session: withRefresh })
    );

    expect(outcome.status).toBe('pass');
    // And no instruction to go and enable a grant that demonstrably works.
    expect(outcome.remediations).toEqual([]);
    // The metadata gap is still reported, as the server's problem not yours.
    expect(outcome.detail).toContain('not listed in `grant_types_supported`');
  });

  it('passes quietly when refresh is both advertised and in hand', async () => {
    const outcome = await grantTypes!.run(
      context({ grants: ['authorization_code', 'refresh_token'], session: withRefresh })
    );

    expect(outcome.status).toBe('pass');
    expect(outcome.summary).toBe('All the grants Swiss needs are advertised.');
    expect(outcome.remediations).toEqual([]);
  });

  it('drops the refresh note when metadata is absent but a token is in hand', async () => {
    const unknown = await grantTypes!.run(context({}));
    expect(unknown.status).toBe('warn');
    expect(unknown.detail).toContain('Refresh support is not advertised');

    // Still a warning, but only about `authorization_code`: an absent
    // `grant_types_supported` is worth flagging on its own, and a refresh
    // token in hand does not prove which grant issued the original tokens.
    const proven = await grantTypes!.run(context({ session: withRefresh }));
    expect(proven.status).toBe('warn');
    expect(proven.detail).toContain('assumes `authorization_code` works');
    expect(proven.detail ?? '').not.toContain('Refresh support is not advertised');
    expect(proven.remediations).toEqual([]);
  });

  it('ignores a refresh token from a session predating a config change', async () => {
    // Those tokens came from whatever server was configured before, so they
    // are not evidence about the one being checked now.
    const outcome = await grantTypes!.run(
      context({
        grants: ['authorization_code'],
        session: { hasRefreshToken: true, staleConfig: true }
      })
    );

    expect(outcome.status).toBe('warn');
    expect(outcome.remediations.map((r) => r.id)).toContain('refresh-not-enabled');
  });

  it('says nothing about refresh when it was never requested', async () => {
    const outcome = await grantTypes!.run(
      context({ grants: ['authorization_code'], scopes: 'openid patient/*.read' })
    );

    expect(outcome.status).toBe('pass');
    expect(outcome.detail ?? '').not.toContain('refresh');
  });

  it('fails when authorization_code itself is missing, refresh token or not', async () => {
    const outcome = await grantTypes!.run(
      context({ grants: ['client_credentials'], session: withRefresh })
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('no interactive login is possible');
  });
});
