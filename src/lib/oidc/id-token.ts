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

import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { httpUrl } from '$lib/url';
import { tryDecodeJwt } from './jwt';

/**
 * ID token validation, reported rather than enforced.
 *
 * OpenID Connect Core 3.1.3.7 tells a client to check the signature, `iss`,
 * `aud`, `exp` and `nonce` before trusting an ID token. Swiss is a diagnostic
 * tool, so a failure here is a finding to show next to the token, not a
 * reason to hide it -- "this server returns the wrong nonce" is exactly what
 * the tool exists to surface. Nothing here is fatal to the sign-in.
 */
export interface IdTokenCheck {
  /** True only when the signature and every checked claim held up. */
  verified: boolean;
  /** Human-readable problems, empty when verified. Each is a warning. */
  findings: string[];
}

export interface IdTokenCheckParams {
  idToken: string;
  clientId: string;
  /** The nonce sent on the authorization request, if any. */
  expectedNonce?: string;
  /** The issuer the discovery document declared; skipped when unknown. */
  issuer?: string;
  /** Where the signing keys live. Skipped (and reported) when absent. */
  jwksUri?: string;
  fetchImpl?: typeof fetch;
}

export async function checkIdToken(params: IdTokenCheckParams): Promise<IdTokenCheck> {
  const findings: string[] = [];

  // The nonce comes from the unverified claims on purpose: a signature
  // failure and a nonce mismatch are separate findings, and a server that
  // gets one wrong often gets the other wrong too.
  const decoded = tryDecodeJwt(params.idToken);
  if (!decoded) {
    return { verified: false, findings: ['The ID token is not a decodable JWT.'] };
  }
  if (params.expectedNonce !== undefined) {
    const nonce = decoded.claims.nonce;
    if (nonce === undefined) {
      findings.push(
        'The ID token carries no `nonce`, but one was sent on the authorization request. OpenID Connect requires the server to echo it, so a conforming client would reject this token.'
      );
    } else if (nonce !== params.expectedNonce) {
      findings.push(
        'The `nonce` in the ID token does not match the one sent on the authorization request. That is what a replayed or substituted token looks like, and a conforming client would reject it.'
      );
    }
  }

  const jwksUri = httpUrl(params.jwksUri);
  if (!jwksUri) {
    findings.push(
      'The ID token signature was not checked: no `jwks_uri` was discovered, so there are no keys to check it against.'
    );
    return { verified: false, findings };
  }

  try {
    const jwks = createRemoteJWKSet(new URL(jwksUri), {
      ...(params.fetchImpl ? { [customFetch]: params.fetchImpl } : {})
    });
    await jwtVerify(params.idToken, jwks, {
      audience: params.clientId,
      ...(params.issuer ? { issuer: params.issuer } : {}),
      // Servers and browsers disagree on the time by a few seconds routinely.
      clockTolerance: 60
    });
    if (!params.issuer) {
      findings.push(
        'The ID token `iss` was not checked against the discovery document, because no issuer was discovered.'
      );
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    findings.push(`The ID token did not verify against \`${jwksUri}\`: ${detail}`);
  }

  return { verified: findings.length === 0, findings };
}
