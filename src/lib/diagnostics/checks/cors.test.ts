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
import type { DiagnosticsContext } from '../types';
import { corsChecks } from './cors';

const check = corsChecks.find((c) => c.id === 'cors.token-endpoint-preflight')!;
const TOKEN = 'https://idp.test/token';
const SECRET = 'live-secret-123';

/** Every request fails the way a CORS refusal does. */
const refused = (async () => {
  throw new TypeError('Failed to fetch');
}) as unknown as typeof fetch;

function ctx(redact: boolean) {
  return {
    config: {
      ...DEFAULTS,
      clientId: 'swiss',
      clientSecret: SECRET,
      clientAuthMethod: 'basic',
      redactSecrets: redact
    },
    origin: 'http://localhost:4200',
    endpoints: { token_endpoint: { value: TOKEN, source: 'smart-configuration' } },
    docs: {},
    gates: null,
    documentUrls: {},
    session: null,
    fetchImpl: refused
  } as unknown as DiagnosticsContext;
}

/** The curl command a failing result offers to copy. */
function copied(r: Awaited<ReturnType<typeof check.run>>): string | undefined {
  return r.remediations?.flatMap((m) => m.actions ?? []).find((a) => a.kind === 'copy')?.value;
}

/** The secret as it travels in the Basic header. */
const basic = btoa(`swiss:${SECRET}`);

describe('cors.token-endpoint-preflight', () => {
  it('copies a curl command without the client secret while redaction is on', async () => {
    const r = await check.run(ctx(true));
    expect(r.status).toBe('fail');
    const curl = copied(r);
    expect(curl).toBeDefined();
    expect(curl).not.toContain(basic);
    expect(curl).not.toContain(SECRET);
  });

  it('includes it once the user has turned redaction off', async () => {
    const r = await check.run(ctx(false));
    const curl = copied(r);
    expect(curl).toContain(basic);
  });
});
