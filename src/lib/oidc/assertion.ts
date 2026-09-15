import { SignJWT } from 'jose';
import { probe } from '$lib/http/probe';
import type { HttpExchange } from '$lib/http/exchange';
import type { SmartTokenResponse } from '$lib/smart/types';
import { decodeJwt, decodeJwtHeader, type JwtClaims, type JwtHeader } from './jwt';
import { loadKeyPair } from './keys';
import type { OAuthErrorResponse } from './token';

/**
 * SMART Backend Services: client-credentials with a JWT client assertion.
 *
 * No redirect, no user, no launch context, no ID token -- so the token
 * inspector and the FHIR console both have to cope with a context-free
 * session.
 */

export const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/** Short-lived by design; SMART recommends no more than five minutes. */
const ASSERTION_LIFETIME_SECONDS = 300;

export interface AssertionParams {
  clientId: string;
  /** The `aud` of the assertion is the TOKEN endpoint, not the FHIR server. */
  tokenEndpoint: string;
}

export interface BuiltAssertion {
  jwt: string;
  header: JwtHeader;
  claims: JwtClaims;
}

/**
 * Builds and signs the assertion.
 *
 * Uses jose rather than hand-rolling the JWS: signing is the one part of this
 * where a subtle encoding mistake produces an opaque server-side rejection,
 * and jose signs directly with a non-extractable CryptoKey.
 */
export async function buildClientAssertion(params: AssertionParams): Promise<BuiltAssertion> {
  const keyPair = await loadKeyPair();
  if (!keyPair) {
    throw new Error('No signing key has been generated yet.');
  }

  const now = Math.floor(Date.now() / 1000);

  const jwt = await new SignJWT({
    // iss and sub are both the client id for a client assertion.
    iss: params.clientId,
    sub: params.clientId,
    aud: params.tokenEndpoint,
    jti: crypto.randomUUID(),
    exp: now + ASSERTION_LIFETIME_SECONDS,
    iat: now
  })
    .setProtectedHeader({ alg: keyPair.alg, kid: keyPair.kid, typ: 'JWT' })
    .sign(keyPair.privateKey);

  return {
    jwt,
    // Decoded back out so the UI can show exactly what was signed. For a
    // diagnostic tool, being able to inspect the assertion before it goes is
    // most of the value.
    header: decodeJwtHeader(jwt),
    claims: decodeJwt(jwt)
  };
}

export interface BackendTokenParams {
  tokenEndpoint: string;
  clientId: string;
  /** System-level scopes, e.g. `system/Patient.rs`. */
  scope: string;
  fetchImpl?: typeof fetch;
}

export interface BackendTokenResult {
  tokens?: SmartTokenResponse;
  error?: OAuthErrorResponse;
  exchange?: HttpExchange;
  assertion?: BuiltAssertion;
  /** Set when the request could not be built at all. */
  buildError?: string;
}

export async function requestBackendToken(params: BackendTokenParams): Promise<BackendTokenResult> {
  let assertion: BuiltAssertion;
  try {
    assertion = await buildClientAssertion({
      clientId: params.clientId,
      tokenEndpoint: params.tokenEndpoint
    });
  } catch (cause) {
    return { buildError: cause instanceof Error ? cause.message : String(cause) };
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: params.scope,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: assertion.jwt
  });

  const { exchange, json, text } = await probe(params.tokenEndpoint, {
    label: 'Backend services token request',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: body.toString(),
    fetchImpl: params.fetchImpl
  });

  if (exchange.outcome === 'network-or-cors' || exchange.outcome === 'blocked-precondition') {
    return { assertion, exchange };
  }

  const asObject =
    json !== null && typeof json === 'object' && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : null;

  if (asObject && typeof asObject.error === 'string') {
    return {
      assertion,
      exchange,
      error: {
        error: asObject.error,
        error_description:
          typeof asObject.error_description === 'string' ? asObject.error_description : undefined,
        raw: json
      }
    };
  }

  if (asObject && typeof asObject.access_token === 'string') {
    return { assertion, exchange, tokens: asObject as unknown as SmartTokenResponse };
  }

  return {
    assertion,
    exchange,
    error: {
      error: 'invalid_response',
      error_description: asObject
        ? 'The response was JSON but contained neither an access_token nor an OAuth error.'
        : `The response was not JSON: ${(text ?? '').slice(0, 200)}`,
      raw: json ?? text
    }
  };
}

/** Rewrites patient/user scopes to system scopes, which is what this flow needs. */
export function suggestSystemScopes(configuredScopes: string): string {
  const system = configuredScopes
    .split(/\s+/)
    .filter(Boolean)
    // No user is present, so none of these mean anything here.
    .filter(
      (s) => !['openid', 'fhirUser', 'profile', 'offline_access', 'online_access'].includes(s)
    )
    .filter((s) => !s.startsWith('launch'))
    .map((s) => s.replace(/^(patient|user)\//, 'system/'));

  return system.length > 0 ? [...new Set(system)].join(' ') : 'system/*.rs';
}
