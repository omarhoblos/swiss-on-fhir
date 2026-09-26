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

import { createRemoteJWKSet, customFetch, errors as joseErrors, jwtVerify } from 'jose';
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
  /**
   * When the check ran. A refresh can return a new ID token, and the panel
   * must not describe that token with the verdict from sign-in.
   */
  at: 'sign-in' | 'refresh';
  /** The `jwks_uri` whose keys verified the signature. */
  keySet?: string;
  /**
   * Higher-precedence `jwks_uri`s that did not answer before `keySet` did.
   * Non-empty means discovery documents disagree and the preferred one is
   * broken, which is worth a warning even though the token verified.
   */
  skippedKeySets?: string[];
}

/**
 * Asymmetric algorithms only. The JWKS is public, so a symmetric `alg`
 * could only ever verify against a key the server also published -- which
 * is to say, against nothing. SMART mandates RS256; the rest are the other
 * algorithms an OIDC provider plausibly signs with.
 */
export const ID_TOKEN_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA'
];

export interface IdTokenCheckParams {
  idToken: string;
  clientId: string;
  /** The nonce sent on the authorization request, if any. */
  expectedNonce?: string;
  /**
   * On refresh, OpenID Connect Core 12.2 requires the new ID token to keep
   * the `sub` of the original. The nonce need not be repeated, so a refresh
   * passes this instead of `expectedNonce`.
   */
  expectedSubject?: string;
  /** The issuer the discovery document declared; skipped when unknown. */
  issuer?: string;
  /** Where the signing keys live. Skipped (and reported) when absent. */
  jwksUri?: string;
  /**
   * Every `jwks_uri` discovery advertised, highest precedence first. Tried
   * in order when the preferred one does not answer: smart-configuration
   * and openid-configuration disagree on this more often than on anything
   * else, and a key set the server itself advertises is a legitimate place
   * to look. `jwksUri` is tried first when both are given.
   */
  jwksUris?: string[];
  fetchImpl?: typeof fetch;
  at?: 'sign-in' | 'refresh';
}

export async function checkIdToken(params: IdTokenCheckParams): Promise<IdTokenCheck> {
  const findings: string[] = [];
  const at = params.at ?? 'sign-in';

  // The nonce comes from the unverified claims on purpose: a signature
  // failure and a nonce mismatch are separate findings, and a server that
  // gets one wrong often gets the other wrong too.
  const decoded = tryDecodeJwt(params.idToken);
  if (!decoded) {
    return { verified: false, findings: ['The ID token is not a decodable JWT.'], at };
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
  if (params.expectedSubject !== undefined && decoded.claims.sub !== params.expectedSubject) {
    findings.push(
      'The refreshed ID token names a different `sub` than the one issued at sign-in. OpenID Connect requires a refresh to keep the same subject, so a conforming client would reject it.'
    );
  }

  // Candidates in precedence order, http(s) only, without duplicates.
  const candidates = [
    ...new Set(
      [params.jwksUri, ...(params.jwksUris ?? [])]
        .map((uri) => httpUrl(uri))
        .filter((uri): uri is string => uri !== null)
    )
  ];
  if (candidates.length === 0) {
    findings.push(
      'The ID token signature was not checked: no `jwks_uri` was discovered, so there are no keys to check it against.'
    );
    return { verified: false, findings, at };
  }

  const failures: string[] = [];
  let keySet: string | undefined;
  for (const jwksUri of candidates) {
    try {
      const jwks = createRemoteJWKSet(new URL(jwksUri), {
        ...(params.fetchImpl ? { [customFetch]: params.fetchImpl } : {})
      });
      await jwtVerify(params.idToken, jwks, {
        algorithms: ID_TOKEN_ALGORITHMS,
        audience: params.clientId,
        ...(params.issuer ? { issuer: params.issuer } : {}),
        // OpenID Connect Core 2 makes these mandatory; `iss` and `aud` are
        // already required by the options above.
        requiredClaims: ['sub', 'exp', 'iat'],
        // Servers and browsers disagree on the time by a few seconds routinely.
        clockTolerance: 60
      });
      keySet = jwksUri;
      break;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      // A claim that fails has nothing to do with which key set was used, so
      // the next candidate cannot help; the signature has already held up.
      if (
        cause instanceof joseErrors.JWTClaimValidationFailed ||
        cause instanceof joseErrors.JWTExpired
      ) {
        findings.push(`The ID token did not verify against \`${jwksUri}\`: ${detail}`);
        return { verified: false, findings, at };
      }
      failures.push(`\`${jwksUri}\`: ${detail}`);
    }
  }

  if (!keySet) {
    findings.push(
      candidates.length === 1
        ? `The ID token did not verify against ${failures[0]}`
        : `The ID token did not verify against any advertised key set. ${failures.join(' ')}`
    );
    return { verified: false, findings, at };
  }

  if (!params.issuer) {
    findings.push(
      'The ID token `iss` was not checked against the discovery document, because no issuer was discovered.'
    );
  }

  const skippedKeySets = candidates.slice(0, candidates.indexOf(keySet));
  return {
    verified: findings.length === 0,
    findings,
    at,
    keySet,
    ...(skippedKeySets.length > 0 ? { skippedKeySets } : {})
  };
}

/** The callback warning for a verification that needed a fallback key set. */
export function describeKeySetFallback(check: IdTokenCheck): string | null {
  if (!check.keySet || !check.skippedKeySets?.length) return null;
  const skipped = check.skippedKeySets.map((uri) => `\`${uri}\``).join(', ');
  return `The ID token verified, but only against \`${check.keySet}\`: the higher-precedence \`jwks_uri\` ${skipped} did not answer. The discovery documents disagree, and a client that trusts only the first one would fail to verify this token.`;
}
