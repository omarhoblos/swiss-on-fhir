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

import { config } from '$lib/config/config.svelte';
import { diagnostics } from '$lib/diagnostics/diagnostics.svelte';
import { exchangeLog } from '$lib/http/log.svelte';
import { snapshotConfig } from '$lib/config/merge';
import { buildAuthorizeUrl } from '$lib/oidc/authorize';
import { createPkce, InsecureContextError, randomUrlSafe } from '$lib/oidc/pkce';
import { exchangeCode, type ClientAuth, type OAuthErrorResponse } from '$lib/oidc/token';
import { resolveLaunchContext } from '$lib/smart/context';
import { session } from './session.svelte';
import type { PersistedSession } from './storage';
import {
  matchCallback,
  saveTransaction,
  setFlowState,
  updateTransactionStatus,
  type AuthTransaction,
  type LaunchIntent
} from './transaction';

/**
 * The authorization flow. Every launch flavour funnels through
 * `beginAuthorization`, and every landing through `completeCallback`, so
 * there is one transaction record and one callback path.
 */

export interface BeginResult {
  ok: boolean;
  /** The URL we are about to navigate to, for preview or for logging. */
  authorizeUrl?: string;
  error?: string;
}

/**
 * Adjusts scopes for an EHR launch.
 *
 * Standalone launch uses `launch/patient`; an EHR launch uses bare `launch`,
 * because the context comes from the `launch` token rather than being
 * requested. Swiss rewrites it and reports exactly what it changed, with an
 * opt-out for testing the non-conforming case.
 */
export function adjustScopesForFlavor(
  scopes: string,
  flavor: LaunchIntent['flavor']
): { scopes: string; changes: string[] } {
  if (flavor !== 'ehr') return { scopes, changes: [] };

  const changes: string[] = [];
  const out: string[] = [];
  let addedLaunch = false;

  for (const scope of scopes.split(/\s+/).filter(Boolean)) {
    if (scope === 'launch/patient' || scope === 'launch/encounter') {
      if (!addedLaunch) {
        out.push('launch');
        addedLaunch = true;
      }
      changes.push(`\`${scope}\` replaced with \`launch\` (the EHR supplies the context)`);
      continue;
    }
    out.push(scope);
  }

  return { scopes: out.join(' '), changes };
}

export interface BeginOptions {
  intent: LaunchIntent;
  /** Send scopes exactly as configured, skipping the EHR-launch rewrite. */
  verbatimScopes?: boolean;
  /** Build the URL and return it without navigating. */
  previewOnly?: boolean;
  pkceMethod?: 'S256' | 'plain';
}

export async function beginAuthorization(options: BeginOptions): Promise<BeginResult> {
  const cfg = config.current;

  // Discovery must have run: we need a real authorization endpoint, not a
  // guess assembled from the issuer.
  if (Object.keys(diagnostics.endpoints).length === 0) {
    await diagnostics.discover();
  }

  const authorizationEndpoint = diagnostics.endpoints.authorization_endpoint?.value;
  if (!authorizationEndpoint) {
    return {
      ok: false,
      error:
        'No authorization endpoint was discovered. Run Diagnostics to see whether the discovery documents are reachable.'
    };
  }
  if (!cfg.clientId) {
    return {
      ok: false,
      error:
        options.intent.flavor === 'ehr'
          ? 'An EHR launch still requires a pre-registered client ID; the EHR does not provide one.'
          : 'No client ID is configured.'
    };
  }

  let pkce;
  try {
    pkce = await createPkce(options.pkceMethod ?? 'S256');
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof InsecureContextError
          ? cause.message
          : `Could not generate a PKCE challenge: ${cause instanceof Error ? cause.message : String(cause)}`
    };
  }

  const state = randomUrlSafe(16);
  const requestedScopes = options.verbatimScopes
    ? cfg.scopes
    : adjustScopesForFlavor(cfg.scopes, options.intent.flavor).scopes;

  // Only generate a nonce when there will be an ID token to bind it to.
  const nonce = requestedScopes.split(/\s+/).includes('openid') ? randomUrlSafe(16) : undefined;

  const redirectUri = config.redirectUri;

  const url = buildAuthorizeUrl({
    authorizationEndpoint,
    config: cfg,
    pkce,
    state,
    nonce,
    launch: options.intent.launch,
    audienceOverride: options.intent.iss,
    scopesOverride: requestedScopes,
    redirectUri
  });

  if (options.previewOnly) {
    return { ok: true, authorizeUrl: url.toString() };
  }

  const transaction: AuthTransaction = {
    state,
    nonce,
    pkce,
    redirectUri,
    clientId: cfg.clientId,
    requestedScopes,
    authorizeUrl: url.toString(),
    endpoints: diagnostics.endpoints,
    configSnapshot: snapshotConfig(cfg),
    intent: options.intent,
    createdAt: Date.now(),
    status: 'pending'
  };

  // Persist BEFORE navigating: once location.assign runs, this page is gone.
  saveTransaction(transaction);
  setFlowState('redirecting');

  location.assign(url.toString());
  return { ok: true, authorizeUrl: url.toString() };
}

export type CallbackOutcome =
  | { kind: 'success'; session: PersistedSession; warnings: string[] }
  | { kind: 'oauth-error'; error: OAuthErrorResponse; deliveredIn: 'query' | 'fragment' }
  | { kind: 'token-error'; error: OAuthErrorResponse }
  | { kind: 'no-code' }
  | {
      kind: 'validation-error';
      code:
        | 'state-mismatch'
        | 'no-transaction'
        | 'code-already-used'
        | 'nonce-mismatch'
        | 'missing-code';
      message: string;
    };

/**
 * Reads an OAuth error from the URL.
 *
 * Checks the fragment as well as the query string: the spec puts code-flow
 * responses in the query, but non-conforming servers use `#error=`, and
 * recording which one it arrived in makes the deviation itself reportable.
 */
export function readOauthError(
  url: URL
): { error: OAuthErrorResponse; deliveredIn: 'query' | 'fragment' } | null {
  const fromQuery = url.searchParams.get('error');
  if (fromQuery) {
    return {
      deliveredIn: 'query',
      error: {
        error: fromQuery,
        error_description: url.searchParams.get('error_description') ?? undefined,
        error_uri: url.searchParams.get('error_uri') ?? undefined
      }
    };
  }

  if (url.hash.length > 1) {
    const hash = new URLSearchParams(url.hash.slice(1));
    const fromHash = hash.get('error');
    if (fromHash) {
      return {
        deliveredIn: 'fragment',
        error: {
          error: fromHash,
          error_description: hash.get('error_description') ?? undefined,
          error_uri: hash.get('error_uri') ?? undefined
        }
      };
    }
  }

  return null;
}

export async function completeCallback(url: URL): Promise<CallbackOutcome> {
  setFlowState('handling-callback');

  // Errors before codes: an error response carries no code, and treating a
  // missing code as the problem would bury the server's actual message.
  const oauthError = readOauthError(url);
  if (oauthError) {
    setFlowState('idle');
    session.setError(oauthError.error);
    return { kind: 'oauth-error', ...oauthError };
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code && !state) {
    setFlowState('idle');
    return { kind: 'no-code' };
  }

  const match = matchCallback(state);

  if (match.kind === 'already-consumed') {
    setFlowState('idle');
    return {
      kind: 'validation-error',
      code: 'code-already-used',
      message:
        'This authorization code has already been exchanged. Reloading the callback page re-sends it, and codes are single-use — the server would reject it with `invalid_grant`, which is easy to misread as a server fault. Start a new launch instead.'
    };
  }

  if (match.kind === 'no-transaction') {
    setFlowState('idle');
    return {
      kind: 'validation-error',
      code: 'no-transaction',
      message:
        match.knownStates === 0
          ? 'No pending authorization was found in this tab. Session storage holds the PKCE verifier, so a callback only works in the tab that started the launch — a bookmarked callback URL, a different tab, or cleared storage will all land here.'
          : `The \`state\` in this callback does not match any pending authorization in this tab (${match.knownStates} known). This may be a cross-site request forgery attempt, or simply a stale callback URL.`
    };
  }

  if (match.kind === 'state-mismatch') {
    setFlowState('idle');
    return {
      kind: 'validation-error',
      code: 'state-mismatch',
      message: 'The callback carried no usable `state`, so it cannot be matched to a launch.'
    };
  }

  if (!code) {
    setFlowState('idle');
    return {
      kind: 'validation-error',
      code: 'missing-code',
      message:
        'The callback carried a matching `state` but no `code` and no `error`, which is not a valid authorization response.'
    };
  }

  const tx = match.transaction;
  const warnings: string[] = [];
  if (match.expired) {
    warnings.push(
      'This authorization was started more than 10 minutes ago, so the code may already have expired. The exchange was attempted anyway — the server’s response is more informative than refusing locally.'
    );
  }

  updateTransactionStatus(tx.state, 'exchanging');

  const auth: ClientAuth = {
    method: tx.configSnapshot.clientAuthMethod,
    clientId: tx.clientId,
    // Read live from its own storage slot rather than from the snapshot, so
    // the secret is not persisted alongside every transaction as well. Editing
    // it mid-flow is already blocked by the flow-state gate.
    clientSecret: config.current.clientSecret,
    formEncodeCredentials: true,
    includeClientIdWithBasic: false
  };

  const tokenEndpoint = tx.endpoints.token_endpoint?.value;
  if (!tokenEndpoint) {
    updateTransactionStatus(tx.state, 'failed');
    setFlowState('idle');
    return {
      kind: 'token-error',
      error: {
        error: 'no_token_endpoint',
        error_description: 'No token endpoint was recorded for this launch.'
      }
    };
  }

  const { tokens, error, exchange } = await exchangeCode({
    tokenEndpoint,
    code,
    // From the snapshot, not live config: recomputing it would produce an
    // inexplicable invalid_grant if settings changed mid-flow.
    redirectUri: tx.redirectUri,
    codeVerifier: tx.pkce.verifier,
    auth
  });
  exchangeLog.record(exchange);

  if (error || !tokens) {
    updateTransactionStatus(tx.state, 'failed');
    setFlowState('idle');
    const finalError: OAuthErrorResponse =
      error ??
      (exchange.diagnosis
        ? {
            error: 'network_error',
            error_description: exchange.diagnosis.evidence.join(' ')
          }
        : { error: 'token_exchange_failed' });
    session.setError(finalError);
    return { kind: 'token-error', error: finalError };
  }

  updateTransactionStatus(tx.state, 'consumed');
  setFlowState('idle');

  // Non-fatal conformance findings: still show the tokens, because "this
  // server returns the wrong nonce" is exactly the kind of finding the tool
  // exists to produce.
  if (tokens.token_type && tokens.token_type.toLowerCase() !== 'bearer') {
    warnings.push(
      `The server returned \`token_type: ${tokens.token_type}\`. Swiss compares this case-insensitively and treats it as a bearer token.`
    );
  }
  if (typeof tokens.expires_in !== 'number') {
    warnings.push(
      'The token response carried no `expires_in`, so the lifetime is unknown. Swiss falls back to the access token’s `exp` claim when it happens to be a JWT.'
    );
  }

  const obtainedAt = Date.now();
  const persisted: PersistedSession = {
    tokens,
    context: resolveLaunchContext(tokens),
    obtainedAt,
    expiresAt: typeof tokens.expires_in === 'number' ? obtainedAt + tokens.expires_in * 1000 : null,
    requestedScopes: tx.requestedScopes,
    intent: tx.intent,
    configSnapshot: tx.configSnapshot,
    tokenEndpoint,
    revocationEndpoint: tx.endpoints.revocation_endpoint?.value,
    endSessionEndpoint: tx.endpoints.end_session_endpoint?.value
  };

  session.establish(persisted);
  return { kind: 'success', session: persisted, warnings };
}
