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

import { probe } from '$lib/http/probe';
import type { HttpExchange } from '$lib/http/exchange';
import type { ClientAuthMethod } from '$lib/config/types';
import type { SmartTokenResponse } from '$lib/smart/types';

/**
 * Token endpoint requests: code exchange, refresh, and revocation.
 *
 * Both HTTP Basic and request-body client authentication are supported
 * because real servers differ and trying either is part of the job. PKCE is
 * always used, in every mode -- SMART 2.0 requires it even for confidential
 * clients.
 */

export interface ClientAuth {
  method: ClientAuthMethod;
  clientId: string;
  clientSecret: string;
  /**
   * RFC 6749 §2.3.1 requires the id and secret to be form-urlencoded before
   * base64. Most servers do not care; some do, and some break when you do
   * it. Hence a toggle rather than a hardcoded choice.
   */
  formEncodeCredentials?: boolean;
  /** Redundant under Basic; some servers reject the duplicate. */
  includeClientIdWithBasic?: boolean;
}

/**
 * Builds the Basic credential.
 *
 * Encodes via TextEncoder rather than passing the string to btoa, which
 * throws on any character outside Latin-1.
 */
export function basicHeader(auth: ClientAuth): string {
  const encode = (v: string) => (auth.formEncodeCredentials === false ? v : encodeURIComponent(v));
  const raw = `${encode(auth.clientId)}:${encode(auth.clientSecret)}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function applyClientAuth(
  auth: ClientAuth,
  body: URLSearchParams,
  headers: Record<string, string>
): void {
  switch (auth.method) {
    case 'none':
      // Mandatory for a public client: RFC 6749 §4.1.3.
      body.set('client_id', auth.clientId);
      break;
    case 'body':
      body.set('client_id', auth.clientId);
      body.set('client_secret', auth.clientSecret);
      break;
    case 'basic':
      headers.Authorization = basicHeader(auth);
      if (auth.includeClientIdWithBasic) body.set('client_id', auth.clientId);
      break;
  }
}

export interface TokenRequestResult {
  tokens?: SmartTokenResponse;
  error?: OAuthErrorResponse;
  exchange: HttpExchange;
}

export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
  error_uri?: string;
  /** Kept whatever the shape, since servers deviate constantly. */
  raw?: unknown;
}

export interface ExchangeCodeParams {
  tokenEndpoint: string;
  code: string;
  /** Must be byte-identical to the authorize request. */
  redirectUri: string;
  codeVerifier: string;
  auth: ClientAuth;
  fetchImpl?: typeof fetch;
}

export async function exchangeCode(params: ExchangeCodeParams): Promise<TokenRequestResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    // Recomputing this from live config instead of the transaction snapshot
    // would produce a baffling invalid_grant after any config edit.
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  };
  applyClientAuth(params.auth, body, headers);

  return postToken(params.tokenEndpoint, body, headers, 'Token exchange', params.fetchImpl);
}

export interface RefreshParams {
  tokenEndpoint: string;
  refreshToken: string;
  auth: ClientAuth;
  /** A narrower scope is legal on refresh, and worth being able to test. */
  scope?: string;
  fetchImpl?: typeof fetch;
}

export async function refreshTokens(params: RefreshParams): Promise<TokenRequestResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken
  });
  if (params.scope) body.set('scope', params.scope);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  };
  applyClientAuth(params.auth, body, headers);

  return postToken(params.tokenEndpoint, body, headers, 'Token refresh', params.fetchImpl);
}

export interface RevokeParams {
  revocationEndpoint: string;
  token: string;
  tokenTypeHint: 'access_token' | 'refresh_token';
  auth: ClientAuth;
  fetchImpl?: typeof fetch;
}

export async function revokeToken(params: RevokeParams): Promise<{ exchange: HttpExchange }> {
  const body = new URLSearchParams({
    token: params.token,
    token_type_hint: params.tokenTypeHint
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  };
  applyClientAuth(params.auth, body, headers);

  const { exchange } = await probe(params.revocationEndpoint, {
    label: `Revoke ${params.tokenTypeHint}`,
    method: 'POST',
    headers,
    body: body.toString(),
    fetchImpl: params.fetchImpl
  });
  return { exchange };
}

/**
 * Parses a token-endpoint response.
 *
 * RFC 6749 §5.2 says a failure is 400 plus a JSON error object. Reality also
 * includes HTML error pages, 401s, 500s, and FHIR OperationOutcomes -- so
 * try each shape in turn and always keep the raw body regardless of which
 * branch won.
 */
async function postToken(
  url: string,
  body: URLSearchParams,
  headers: Record<string, string>,
  label: string,
  fetchImpl?: typeof fetch
): Promise<TokenRequestResult> {
  const { exchange, json, text } = await probe(url, {
    label,
    method: 'POST',
    headers,
    body: body.toString(),
    fetchImpl
  });

  if (exchange.outcome === 'network-or-cors' || exchange.outcome === 'blocked-precondition') {
    return { exchange };
  }

  const asObject =
    json !== null && typeof json === 'object' && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : null;

  if (asObject && typeof asObject.error === 'string') {
    return {
      error: {
        error: asObject.error,
        error_description:
          typeof asObject.error_description === 'string' ? asObject.error_description : undefined,
        error_uri: typeof asObject.error_uri === 'string' ? asObject.error_uri : undefined,
        raw: json
      },
      exchange
    };
  }

  if (asObject && typeof asObject.access_token === 'string') {
    return { tokens: asObject as unknown as SmartTokenResponse, exchange };
  }

  // A FHIR OperationOutcome from a token endpoint is non-conformant but does
  // happen; surface it as an error rather than pretending we got tokens.
  if (asObject?.resourceType === 'OperationOutcome') {
    return {
      error: {
        error: 'operation_outcome',
        error_description:
          'The token endpoint returned a FHIR OperationOutcome instead of an OAuth error object.',
        raw: json
      },
      exchange
    };
  }

  return {
    error: {
      error: 'invalid_response',
      error_description: asObject
        ? 'The response was JSON but contained neither an access_token nor an OAuth error.'
        : `The response was not JSON: ${(text ?? '').slice(0, 200)}`,
      raw: json ?? text
    },
    exchange
  };
}
