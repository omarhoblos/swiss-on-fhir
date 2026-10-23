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

import { config } from '#lib/config/config.svelte.ts';
import { configEquivalentForAuth } from '#lib/config/merge.ts';
import { exchangeLog } from '#lib/http/log.svelte.ts';
import { checkIdToken } from '#lib/oidc/id-token.ts';
import { tryDecodeJwt } from '#lib/oidc/jwt.ts';
import {
  refreshTokens,
  revokeToken,
  type ClientAuth,
  type OAuthErrorResponse
} from '#lib/oidc/token.ts';
import { resolveLaunchContext } from '#lib/smart/context.ts';
import { diffScopes, resolveGrantedScopes } from '#lib/smart/scopes.ts';
import { untrack } from 'svelte';
import type { StorageMode } from '#lib/config/types.ts';
import { DEFAULT_ENVIRONMENT_ID, type LaunchType } from '#lib/environments/types.ts';
import { CLOCK_SKEW_THRESHOLD_SECONDS } from '#lib/time.ts';
import { httpUrl } from '#lib/url.ts';
import {
  createSessionStore,
  loadActiveSlot,
  migrateLegacySession,
  saveActiveSlot,
  storedLaunchTypes,
  type PersistedSession
} from './storage';

/**
 * A single ticking clock for the whole app.
 *
 * One interval, started in the root layout, feeding one signal that every
 * countdown derives from. The Angular app captured `dayjs()` once at
 * component construction and never updated it, so its "expires in N minutes"
 * banner was frozen at whatever it said when the page loaded.
 */
export const clock = $state({ now: Date.now() });

/**
 * The session shown in this tab: one slot, for the active environment and
 * one launch type.
 *
 * Each environment keeps up to three sessions, one per launch type, so a
 * Backend Services token never replaces a standalone one. Nothing is loaded
 * until `load()` runs from the root layout, after the configuration is
 * hydrated: the storage mode is a setting, and at import time the setting is
 * still the built-in default, which used to lose a `local` session on reload.
 */
class SessionStore {
  #envId = $state(DEFAULT_ENVIRONMENT_ID);
  #slot = $state<LaunchType>('standalone');
  #held = $state<LaunchType[]>([]);
  #loaded = false;
  #session = $state<PersistedSession | null>(null);
  #lastError = $state<OAuthErrorResponse | null>(null);
  #busy = $state(false);

  constructor() {
    // Changing the Token storage setting moves the stored sessions at once,
    // so switching to memory-only takes them off disk now, not at the next
    // save. Only after load(): before it the setting is not yet hydrated.
    $effect.root(() => {
      $effect(() => {
        const mode = config.current.tokenStorage;
        untrack(() => {
          if (this.#loaded) this.#relocate(mode);
        });
      });
    });
  }

  /** The environment whose sessions this tab shows. */
  readonly environmentId = $derived(this.#envId);
  /** The launch type of the session shown. */
  readonly slot = $derived(this.#slot);
  /** Launch types holding a session for this environment. */
  readonly heldSlots = $derived(this.#held);

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

  /**
   * Whether the configured client secret is kept from this session's
   * server. The snapshot holds only whether a secret was set, not its value,
   * so the secret is read live; it is taken to belong to the session only
   * when the session was signed in with one, for the authorization server and
   * client ID still configured. Otherwise it was set for another server, and
   * a refresh or revoke would hand it to this session's endpoints.
   */
  readonly secretWithheld = $derived.by(() => {
    const session = this.#session;
    const now = config.current;
    if (!session || !now.clientSecret) return false;
    const snapshot = session.configSnapshot;
    return !(
      snapshot.hasClientSecret &&
      snapshot.authIssuer === now.authIssuer &&
      snapshot.clientId === now.clientId
    );
  });

  #withheldNote(): string {
    return this.secretWithheld
      ? ' The configured client secret was not sent: it was set for a different authorization server or client than this session’s.'
      : '';
  }

  /**
   * Shows an environment's sessions: the slot this tab last showed for it if
   * that still holds tokens, else the first that does, else that slot empty.
   */
  load(envId: string): void {
    migrateLegacySession();
    this.#loaded = true;
    this.#envId = envId;
    this.#lastError = null;
    const held = storedLaunchTypes(envId);
    this.#held = held;
    const remembered = loadActiveSlot(envId);
    this.#slot =
      remembered && held.includes(remembered)
        ? remembered
        : (held[0] ?? remembered ?? 'standalone');
    this.#session = this.#store(envId, this.#slot).load();
  }

  /** Shows another launch type's session for the same environment. */
  selectSlot(launchType: LaunchType): void {
    if (launchType === this.#slot) return;
    this.#slot = launchType;
    this.#lastError = null;
    saveActiveSlot(this.#envId, launchType);
    this.#session = this.#store(this.#envId, launchType).load();
  }

  /** Where an environment keeps its sessions, from that environment's own setting. */
  #store(envId: string, launchType: LaunchType) {
    const mode = config.effectiveFor(envId)?.tokenStorage ?? config.current.tokenStorage;
    return createSessionStore(mode, envId, launchType);
  }

  #relocate(mode: StorageMode): void {
    // load() moves a copy found elsewhere to `mode`.
    for (const launchType of this.#held) createSessionStore(mode, this.#envId, launchType).load();
  }

  /**
   * Writes one slot, and shows the result only if this tab still shows that
   * slot. Every async path captures its environment and slot before its
   * first await and commits through here, so a switch while a request is in
   * flight cannot put one environment's tokens in another's place.
   */
  #commit(envId: string, launchType: LaunchType, next: PersistedSession | null): void {
    const store = this.#store(envId, launchType);
    if (next) store.save(next);
    else store.clear();
    if (envId !== this.#envId) return;
    this.#held = storedLaunchTypes(envId);
    if (launchType === this.#slot) this.#session = next;
  }

  #isShowing(envId: string, launchType: LaunchType): boolean {
    return envId === this.#envId && launchType === this.#slot;
  }

  #clientAuth(): ClientAuth {
    const snapshot = this.#session?.configSnapshot ?? config.current;
    return {
      method: snapshot.clientAuthMethod,
      clientId: snapshot.clientId,
      clientSecret: this.secretWithheld ? '' : config.current.clientSecret,
      formEncodeCredentials: true,
      includeClientIdWithBasic: false
    };
  }

  /** Stores new tokens in an environment's slot for a launch type, and shows them. */
  establish(envId: string, launchType: LaunchType, session: PersistedSession): void {
    saveActiveSlot(envId, launchType);
    if (envId === this.#envId) {
      this.#slot = launchType;
      this.#lastError = null;
    }
    this.#commit(envId, launchType, session);
  }

  /**
   * Manual refresh.
   *
   * Auto-refresh is off by default and opt-in. For a diagnostic tool the
   * moment of failure IS the information: a silent renewal that succeeds
   * teaches nothing, and one that fails looks like a random logout.
   */
  async refresh(options: { scope?: string } = {}): Promise<{ ok: boolean; message: string }> {
    const outcome = await this.#refresh(options);
    return { ...outcome, message: outcome.message + this.#withheldNote() };
  }

  async #refresh(options: { scope?: string }): Promise<{ ok: boolean; message: string }> {
    const session = this.#session;
    if (!session) return { ok: false, message: 'No active session.' };
    const envId = this.#envId;
    const launchType = this.#slot;

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
      const auth = this.#clientAuth();
      const { tokens, findings, error, exchange } = await refreshTokens({
        tokenEndpoint,
        refreshToken,
        auth,
        scope: options.scope
      });
      exchangeLog.record(exchange, envId);

      if (error || !tokens) {
        const failure = error ?? {
          error: 'refresh_failed',
          error_description: 'The refresh request did not return tokens.'
        };
        if (this.#isShowing(envId, launchType)) this.#lastError = failure;
        return {
          ok: false,
          message: error?.error_description ?? error?.error ?? 'The refresh request failed.'
        };
      }

      const rotated = Boolean(tokens.refresh_token) && tokens.refresh_token !== refreshToken;
      const obtainedAt = Date.now();

      const nextTokens = {
        ...tokens,
        // A server may omit the refresh token on rotation-free renewal, in
        // which case the existing one stays valid.
        refresh_token: tokens.refresh_token ?? refreshToken
      };

      // A refresh may carry a new ID token, and the verdict from sign-in says
      // nothing about it. Check the new one; or, when none came back, keep
      // showing the sign-in token together with its own verdict.
      let idTokenCheck = session.idTokenCheck;
      let idTokenNote = '';
      if (tokens.id_token) {
        const previousSub = session.tokens.id_token
          ? tryDecodeJwt(session.tokens.id_token)?.claims.sub
          : undefined;
        idTokenCheck = await checkIdToken({
          idToken: tokens.id_token,
          clientId: auth.clientId,
          issuer: session.issuer,
          jwksUri: session.jwksUri,
          jwksUris: session.jwksUris,
          expectedSubject: typeof previousSub === 'string' ? previousSub : undefined,
          onExchange: (exchange) => exchangeLog.record(exchange, envId),
          at: 'refresh'
        });
        idTokenNote = idTokenCheck.verified
          ? ' The new ID token verified.'
          : ` The new ID token did NOT verify: ${idTokenCheck.findings.join(' ')}`;
      } else if (session.tokens.id_token) {
        nextTokens.id_token = session.tokens.id_token;
        idTokenNote = ' No new ID token was returned, so the one from sign-in is still shown.';
      }

      if (this.#isShowing(envId, launchType)) this.#lastError = null;
      this.#commit(envId, launchType, {
        ...session,
        tokens: nextTokens,
        context: resolveLaunchContext(nextTokens),
        obtainedAt,
        expiresAt:
          typeof tokens.expires_in === 'number' ? obtainedAt + tokens.expires_in * 1000 : null,
        idTokenCheck
      });

      return {
        ok: true,
        message:
          (rotated
            ? 'Refreshed. Your server rotated the refresh token, so the previous one is now invalid.'
            : 'Refreshed. Your server returned no new refresh token, so the existing one remains valid.') +
          idTokenNote +
          (findings?.length ? ` ${findings.join(' ')}` : '')
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
    const note = this.#withheldNote();
    const outcome = await this.#revoke();
    return { ...outcome, message: outcome.message + note };
  }

  async #revoke(): Promise<{ ok: boolean; message: string }> {
    const session = this.#session;
    if (!session) return { ok: false, message: 'No active session.' };
    const envId = this.#envId;

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
      const refused: string[] = [];
      const send = async (token: string, tokenTypeHint: 'access_token' | 'refresh_token') => {
        const { exchange, error } = await revokeToken({
          revocationEndpoint: endpoint,
          token,
          tokenTypeHint,
          auth
        });
        exchangeLog.record(exchange, envId);
        if (exchange.outcome !== 'ok') {
          const status = exchange.response
            ? `${exchange.response.status} ${exchange.response.statusText}`.trim()
            : exchange.outcome;
          const what = tokenTypeHint === 'refresh_token' ? 'refresh token' : 'access token';
          refused.push(`${what}: ${status}${error ? ` (${error})` : ''}`);
        }
      };
      // Refresh token first: on many servers revoking it cascades. The access
      // token is still sent when that fails, so each answer is on record.
      if (session.tokens.refresh_token) await send(session.tokens.refresh_token, 'refresh_token');
      await send(session.tokens.access_token, 'access_token');

      if (refused.length > 0) {
        return {
          ok: false,
          message: `The server did not accept the revocation (${refused.join('; ')}). The tokens may still be valid; the exchange log has the server's answer.`
        };
      }
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
    // This becomes a same-tab link, so it must be a real web URL: a
    // `javascript:` value from a hostile discovery document would run here.
    const safeEndpoint = httpUrl(endpoint);
    if (!safeEndpoint) {
      return {
        url: null,
        reason: `The advertised \`end_session_endpoint\` (\`${endpoint}\`) is not an http(s) URL, so Swiss will not link to it.`
      };
    }
    const url = new URL(safeEndpoint);
    if (session?.tokens.id_token) url.searchParams.set('id_token_hint', session.tokens.id_token);
    url.searchParams.set('client_id', session?.configSnapshot.clientId ?? config.current.clientId);
    if (config.origin) url.searchParams.set('post_logout_redirect_uri', config.origin);
    return { url: url.toString() };
  }

  /** Discards the session shown, locally only. The other slots are kept. */
  clear(): void {
    this.#lastError = null;
    this.#commit(this.#envId, this.#slot, null);
  }

  setError(error: OAuthErrorResponse | null): void {
    this.#lastError = error;
  }
}

export const session = new SessionStore();
