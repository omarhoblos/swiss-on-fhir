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

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64url, challengeS256, createPkce, randomUrlSafe } from './pkce';

const URL_SAFE = /^[A-Za-z0-9_-]+$/;

describe('pkce', () => {
  it('produces a 43-character base64url verifier from 32 bytes', async () => {
    const pkce = await createPkce();
    expect(pkce.method).toBe('S256');
    expect(pkce.verifier).toHaveLength(43);
    expect(pkce.verifier).toMatch(URL_SAFE);
    expect(pkce.challenge).toMatch(URL_SAFE);
  });

  it('computes the S256 challenge as base64url(sha256(verifier))', async () => {
    const verifier = randomUrlSafe(32);
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(await challengeS256(verifier)).toBe(expected);
  });

  it('does not repeat verifiers', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(randomUrlSafe(32));
    expect(seen.size).toBe(50);
  });

  it('sends the verifier as the challenge under plain, for testing servers', async () => {
    const pkce = await createPkce('plain');
    expect(pkce.method).toBe('plain');
    expect(pkce.challenge).toBe(pkce.verifier);
  });

  it('base64url strips padding and uses the URL alphabet', () => {
    // 0xfb 0xff -> "+/8=" in standard base64.
    expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });
});
