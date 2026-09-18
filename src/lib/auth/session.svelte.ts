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
import { configEquivalentForAuth } from '$lib/config/merge';
import { exchangeLog } from '$lib/http/log.svelte';
import { tryDecodeJwt } from '$lib/oidc/jwt';
import {
  refreshTokens,
  revokeToken,
  type ClientAuth,
  type OAuthErrorResponse
} from '$lib/oidc/token';
import { resolveLaunchContext } from '$lib/smart/context';
import { diffScopes, resolveGrantedScopes } from '$lib/smart/scopes';
import { CLOCK_SKEW_THRESHOLD_SECONDS } from '$lib/time';
import { clearAllSwissKeys, createSessionStore, type PersistedSession } from './storage';

/**
 * A single ticking clock for the whole app.
 *
 * One interval, started in the root layout, feeding one signal that every
 * countdown derives from. The Angular app captured `dayjs()` once at
 * component construction and never updated it, so its "expires in N minutes"
 * banner was frozen at whatever it said when the page loaded.
 */
export const clock = $state({ now: Date.now() });

class SessionStore {
  #session = $state<PersistedSession | null>(null);
  #lastError = $state<OAuthErrorResponse | null>(null);
  #busy = $state(false);

  constructor() {
    this.#session = createSessionStore(config.current.tokenStorage).load();
  }

  readonly current = $derived(this.#session);
  readonly isAuthenticated = $derived(this.#session !== null);
  readonly tokens = $derived(this.#session?.tokens ?? null);
  readonly context = $derived(this.#session?.context ?? null);
  readonly lastError = $derived(this.#lastError);
  readonly busy = $derived(this.#busy);

  readonly accessToken = $derived(this.#session?.tokens.access_token ?? null);

  readonly secondsRemaining = $derived(
    this.#session?.expiresAt ? Math.floor((this.#session.expiresAt - clock.now) / 1000) : null
  );

  readonly isExpired = $derived((this.secondsRemaining ?? 1) < 0);

  /** Decoded access token, when it happens to be a JWT (it need not be). */
  readonly accessTokenJwt = $derived(
    this.#session ? tryDecodeJwt(this.#session.tokens.access_token) : null
  );

  readonly idTokenJwt = $derived(
    this.#session?.tokens.id_token ? tryDecodeJwt(this.#session.tokens.id_token) : null
  );

  readonly grantedScopes = $derived(
    this.#session
      ? resolveGrantedScopes(
          this.#session.tokens.scope,
          this.accessTokenJwt?.claims ?? null,
          this.#session.requestedScopes
        )
      : null
  );

  readonly scopeDiff = $derived(
    this.#session && this.grantedScopes
      ? diffScopes(this.#session.requestedScopes, this.grantedScopes.value)
      : null
  );

  /**
   * Set when the config has moved since these tokens were issued.
   *
   * Deliberately NOT a reason to discard them: tokens obtained under one
   * configuration are still real tokens, and watching a server reject them
   * is a legitimate test. Swiss surfaces the divergence and lets the user
   * decide.
   */
  readonly staleConfig = $derived(
    this.#session !== null && !configEquivalentForAuth(this.#session.configSnapshot, config.current)
  );

  /** What changed, so the warning can be specific rather than vague. */
  readonly staleFields = $derived.by(() => {
    if (!this.#session) return [];
    const snapshot = this.#session.configSnapshot;
    const now = config.current;
    const changed: string[] = [];
    if (snapshot.authIssuer !== now.authIssuer) {
      changed.push(`authorization server (${snapshot.authIssuer} → ${now.authIssuer})`);
    }
    if (snapshot.clientId !== now.clientId) {
      changed.push(`client ID (${snapshot.clientId} → ${now.clientId})`);
    }
    if (snapshot.scopes !== now.scopes) changed.push('requested scopes');
    if (snapshot.hasClientSecret !== Boolean(now.clientSecret)) {
      changed.push('client secret presence');
    }
    return changed;
  });

  /**
   * Clock skew between the server's `exp` and its own `expires_in`.
   *
   * Worth surfacing because skew causes JWT validation failures elsewhere in
   * the user's stack that present as signature problems, and this tool is in
   * an unusually good position to notice it.
   */
  readonly clockSkewSeconds = $derived.by(() => {
    const session = this.#session;
    if (!session?.expiresAt) return null;
    const exp = this.accessTokenJwt?.claims.exp;
    if (typeof exp !== 'number') return null;
    return Math.round((exp * 1000 - session.expiresAt) / 1000);
  });

  readonly hasClockSkew = $derived(
    this.clockSkewSeconds !== null && Math.abs(this.clockSkewSeconds) > CLOCK_SKEW_THRESHOLD_SECONDS
  );

  #clientAuth(): ClientAuth {
    const snapshot = this.#session?.configSnapshot ?? config.current;
    return {
      method: snapshot.clientAuthMethod,
      clientId: snapshot.clientId,
      // Live from its own slot: the snapshot deliberately carries only
      // whether a secret was set, not its value.
      clientSecret: config.current.clientSecret,
      formEncodeCredentials: true,
      includeClientIdWithBasic: false
    };
  }

  #persist(): void {
    const store = createSessionStore(config.current.tokenStorage);
    if (this.#session) store.save(this.#session);
    else store.clear();
  }

  establish(session: PersistedSession): void {
    this.#session = session;
    this.#lastError = null;
    this.#persist();
  }

  /**
   * Manual refresh.
   *
   * Auto-refresh is off by default and opt-in. For a diagnostic tool the
   * moment of failure IS the information: a silent renewal that succeeds
   * teaches nothing, and one that fails looks like a random logout.
   */
  async refresh(options: { scope?: string } = {}): Promise<{ ok: boolean; message: string }> {
    const session = this.#session;
    if (!session) return { ok: false, message: 'No active session.' };

    const refreshToken = session.tokens.refresh_token;
    if (!refreshToken) {
      return {
        ok: false,
        message:
          'This session has no refresh token. Request `offline_access` and make sure the Refresh Token flow is enabled for your client.'
      };
    }
    const tokenEndpoint = session.tokenEndpoint;
    if (!tokenEndpoint) {
      return { ok: false, message: 'No token endpoint is known for this session.' };
    }

    this.#busy = true;
    try {
      const { tokens, error, exchange } = await refreshTokens({
        tokenEndpoint,
        refreshToken,
        auth: this.#clientAuth(),
        scope: options.scope
      });
      exchangeLog.record(exchange);

      if (error || !tokens) {
        this.#lastError = error ?? {
          error: 'refresh_failed',
          error_description: 'The refresh request did not return tokens.'
        };
        return {
          ok: false,
          message: error?.error_description ?? error?.error ?? 'The refresh request failed.'
        };
      }

      const rotated = Boolean(tokens.refresh_token) && tokens.refresh_token !== refreshToken;
      const obtainedAt = Date.now();

      this.#session = {
        ...session,
        tokens: {
          ...tokens,
          // A server may omit the refresh token on rotation-free renewal, in
          // which case the existing one stays valid.
          refresh_token: tokens.refresh_token ?? refreshToken
        },
        context: resolveLaunchContext(tokens),
        obtainedAt,
        expiresAt:
          typeof tokens.expires_in === 'number' ? obtainedAt + tokens.expires_in * 1000 : null
      };
      this.#lastError = null;
      this.#persist();

      return {
        ok: true,
        message: rotated
          ? 'Refreshed. Your server rotated the refresh token, so the previous one is now invalid.'
          : 'Refreshed. Your server returned no new refresh token, so the existing one remains valid.'
      };
    } finally {
      this.#busy = false;
    }
  }

  /**
   * Revokes the tokens server-side, refresh token first.
   *
   * Note RFC 7009: a server returns 200 even for a token it does not
   * recognise, so success here does not prove anything was revoked.
   */
  async revoke(): Promise<{ ok: boolean; message: string }> {
    const session = this.#session;
    if (!session) return { ok: false, message: 'No active session.' };

    const endpoint = session.revocationEndpoint;
    if (!endpoint) {
      return {
        ok: false,
        message:
          'The server does not advertise a revocation endpoint, so the tokens cannot be revoked remotely.'
      };
    }

    this.#busy = true;
    try {
      const auth = this.#clientAuth();
      // Refresh token first: on many servers revoking it cascades.
      if (session.tokens.refresh_token) {
        const { exchange } = await revokeToken({
          revocationEndpoint: endpoint,
          token: session.tokens.refresh_token,
          tokenTypeHint: 'refresh_token',
          auth
        });
        exchangeLog.record(exchange);
      }
      const { exchange } = await revokeToken({
        revocationEndpoint: endpoint,
        token: session.tokens.access_token,
        tokenTypeHint: 'access_token',
        auth
      });
      exchangeLog.record(exchange);

      return {
        ok: true,
        message:
          'Revocation requested. RFC 7009 has servers return 200 even for an unknown token, so this does not by itself prove the tokens were invalidated — try a FHIR request to confirm.'
      };
    } finally {
      this.#busy = false;
    }
  }

  /** Builds the RP-initiated logout URL, or explains why there is none. */
  endSessionUrl(): { url: string | null; reason?: string } {
    const session = this.#session;
    const endpoint = session?.endSessionEndpoint;
    if (!endpoint) {
      return {
        url: null,
        reason:
          'The server does not advertise `end_session_endpoint`, so Swiss can only discard its own tokens. Your session at the identity provider stays active, which means the next login may not prompt for credentials.'
      };
    }
    const url = new URL(endpoint);
    if (session?.tokens.id_token) url.searchParams.set('id_token_hint', session.tokens.id_token);
    url.searchParams.set('client_id', session?.configSnapshot.clientId ?? config.current.clientId);
    if (config.origin) url.searchParams.set('post_logout_redirect_uri', config.origin);
    return { url: url.toString() };
  }

  /** Discards the local session only. */
  clear(): void {
    this.#session = null;
    this.#lastError = null;
    createSessionStore(config.current.tokenStorage).clear();
  }

  /** Discards everything Swiss stores, including config overrides. */
  clearEverything(): void {
    this.#session = null;
    this.#lastError = null;
    clearAllSwissKeys();
  }

  setError(error: OAuthErrorResponse | null): void {
    this.#lastError = error;
  }
}

export const session = new SessionStore();
