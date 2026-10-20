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

import { createLocalJWKSet, errors as joseErrors, jwtVerify, type JSONWebKeySet } from 'jose';
import type { HttpExchange, NetworkCause } from '#lib/http/exchange.ts';
import { probeJson } from '#lib/http/probe.ts';
import { httpUrl } from '#lib/url.ts';
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

/** Servers and browsers disagree on the time by a few seconds routinely. */
const CLOCK_TOLERANCE_SECONDS = 60;

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
  /**
   * Receives each key set request, so the caller can put it in the exchange
   * log. Not part of the result, which is persisted with the session.
   */
  onExchange?: (exchange: HttpExchange) => void;
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

  // jose would refuse these before looking at any key, so no key set is
  // fetched for a token it could never verify.
  const alg = decoded.header.alg;
  if (typeof alg !== 'string' || !ID_TOKEN_ALGORITHMS.includes(alg)) {
    findings.push(describeAlgorithm(alg));
    return { verified: false, findings, at };
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
  let unreadable = 0;
  let keySet: string | undefined;
  for (const jwksUri of candidates) {
    // Through probe(), like every other request, so the fetch is logged and
    // a blocked one gets the same diagnosis as anywhere else in Swiss.
    const fetched = await probeJson(jwksUri, {
      label: 'ID token key set (jwks_uri)',
      fetchImpl: params.fetchImpl
    });
    params.onExchange?.(fetched.exchange);
    if (!fetched.ok) {
      unreadable += 1;
      failures.push(
        `\`${jwksUri}\` could not be read, because ${describeUnreadableKeySet(fetched.exchange)}`
      );
      continue;
    }
    try {
      const jwks = createLocalJWKSet(fetched.json as JSONWebKeySet);
      await jwtVerify(params.idToken, jwks, {
        algorithms: ID_TOKEN_ALGORITHMS,
        audience: params.clientId,
        ...(params.issuer ? { issuer: params.issuer } : {}),
        // OpenID Connect Core 2 makes these mandatory; `iss` and `aud` are
        // already required by the options above.
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS
      });
      keySet = jwksUri;
      break;
    } catch (cause) {
      // A claim that fails has nothing to do with which key set was used, so
      // the next candidate cannot help; the signature has already held up.
      if (
        cause instanceof joseErrors.JWTClaimValidationFailed ||
        cause instanceof joseErrors.JWTExpired
      ) {
        findings.push(describeClaimFailure(cause, jwksUri, params));
        return { verified: false, findings, at };
      }
      const detail = cause instanceof Error ? cause.message : String(cause);
      failures.push(`\`${jwksUri}\`: ${detail}`);
    }
  }

  if (!keySet) {
    const logNote = unreadable > 0 ? ' The exchange log has the request.' : '';
    findings.push(
      unreadable === candidates.length && candidates.length === 1
        ? `The ID token signature was not checked: the key set at ${failures[0]}${logNote}`
        : candidates.length === 1
          ? `The ID token did not verify against ${failures[0]}`
          : `The ID token did not verify against any advertised key set. ${failures.join(' ')}${logNote}`
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

/**
 * A claim value as it appears in a finding. It is server text, so it is
 * shortened and kept from closing the backticks around it.
 */
function quoted(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const short = text.length > 200 ? `${text.slice(0, 200)}…` : text;
  return `\`${short.replaceAll('`', "'")}\``;
}

function timestamp(seconds: unknown): string {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? `${new Date(seconds * 1000).toISOString()} (${seconds})`
    : quoted(seconds);
}

/**
 * Says which claim failed, with what the server sent beside what was
 * expected. jose's own message names neither value, and coming after a
 * signature check it read as though the key set were at fault.
 */
function describeClaimFailure(
  cause: InstanceType<typeof joseErrors.JWTClaimValidationFailed | typeof joseErrors.JWTExpired>,
  jwksUri: string,
  params: IdTokenCheckParams
): string {
  const { claim, reason, payload } = cause;
  const received = payload[claim];
  const lead = `The signature verified against \`${jwksUri}\`, but`;
  const reject = 'A conforming client would reject this token.';
  if (reason === 'missing') {
    return `${lead} the token has no \`${claim}\` claim, which OpenID Connect Core 2 requires in every ID token. ${reject}`;
  }
  if (reason === 'invalid') {
    return `${lead} \`${claim}\` is ${quoted(received)}, not a number of seconds since 1970. ${reject}`;
  }
  switch (claim) {
    case 'iss':
      return `${lead} \`iss\` is ${quoted(received)}, not ${quoted(params.issuer)}, the issuer the discovery document declares. ${reject}`;
    case 'aud':
      return `${lead} \`aud\` is ${quoted(received)}, which does not include this client's ID, ${quoted(params.clientId)}. ${reject}`;
    case 'exp':
      return `${lead} the token expired at ${timestamp(received)}, more than ${CLOCK_TOLERANCE_SECONDS} seconds before this check. ${reject}`;
    case 'nbf':
      return `${lead} the token is not valid until ${timestamp(received)}, more than ${CLOCK_TOLERANCE_SECONDS} seconds from now. ${reject}`;
    default:
      return `${lead} ${cause.message}. ${reject}`;
  }
}

const UNREADABLE_CAUSES: Partial<Record<NetworkCause, string>> = {
  'cors-missing-acao':
    'the server answered without an `Access-Control-Allow-Origin` header for this page, so the browser withheld the keys (CORS).',
  'cors-preflight': 'the browser’s CORS preflight for it was refused.',
  'mixed-content': 'this page is https and the key set is http, which the browser blocks.',
  'dns-or-refused':
    'the connection never completed: the host did not resolve, or nothing is listening.',
  tls: 'the connection never completed, most likely because of the certificate.',
  'private-network': 'the browser blocked it under Private Network Access.',
  timeout: 'it did not answer in time.'
};

/** Why a key set could not be used, from the diagnosis probe() made. */
function describeUnreadableKeySet(exchange: HttpExchange): string {
  const status = exchange.response?.status;
  switch (exchange.outcome) {
    case 'http-error':
      return `it answered HTTP ${status}.`;
    case 'invalid-json':
      return 'its body is not valid JSON.';
    case 'aborted':
      return 'the request was stopped.';
    case 'timeout':
    case 'network-or-cors':
    case 'blocked-precondition':
      return (
        UNREADABLE_CAUSES[exchange.diagnosis?.likelyCause ?? 'unknown'] ??
        'the request failed, and the browser does not say why.'
      );
    default:
      return `it answered HTTP ${status}, but not with a JSON key set.`;
  }
}

/** Says why a token signed with an algorithm off the allow-list was not checked. */
function describeAlgorithm(alg: unknown): string {
  if (typeof alg === 'string' && alg.toLowerCase() === 'none') {
    return 'The ID token is unsigned (`alg: none`), so nothing proves the server issued it. OpenID Connect allows an unsigned ID token only for a client registered to receive one, and a conforming client would reject it.';
  }
  return `The ID token is signed with ${quoted(alg)}, which is not one of the algorithms Swiss verifies ID tokens with (${ID_TOKEN_ALGORITHMS.join(', ')}), so the signature was not checked.`;
}

/** The callback warning for a verification that needed a fallback key set. */
export function describeKeySetFallback(check: IdTokenCheck): string | null {
  if (!check.keySet || !check.skippedKeySets?.length) return null;
  const skipped = check.skippedKeySets.map((uri) => `\`${uri}\``).join(', ');
  return `The ID token verified, but only against \`${check.keySet}\`: the higher-precedence \`jwks_uri\` ${skipped} did not answer. The discovery documents disagree, and a client that trusts only the first one would fail to verify this token.`;
}
