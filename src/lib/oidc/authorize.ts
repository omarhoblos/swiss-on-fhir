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

import type { AppConfig, AudMode } from '$lib/config/types';
import type { Pkce } from './pkce';

/**
 * Builds the authorization request URL.
 *
 * Swiss constructs this itself rather than delegating to a library, so the
 * exact URL can be previewed before navigating and every parameter is
 * visible. For a tool whose job is finding out what a server accepts, that
 * transparency is the feature.
 */

export interface AuthorizeParams {
  authorizationEndpoint: string;
  config: AppConfig;
  pkce: Pkce;
  state: string;
  nonce?: string;
  /** The opaque token from an EHR launch, passed straight through. */
  launch?: string;
  /** Overrides config.fhirBaseUrl for `aud` during an EHR launch. */
  audienceOverride?: string;
  /** Overrides the configured scopes (e.g. after EHR-launch adjustment). */
  scopesOverride?: string;
  redirectUri: string;
}

/**
 * Applies the aud variant.
 *
 * SMART requires `aud` to identify the FHIR server, but servers disagree
 * about the exact form and some reject an `aud` they do not recognise, so
 * this is configurable rather than fixed. The Angular app sent no `aud` at
 * all, which many SMART servers reject outright.
 */
export function audValue(base: string, mode: AudMode): string | null {
  if (mode === 'omit' || !base) return null;
  const withoutSlash = base.replace(/\/+$/, '');
  switch (mode) {
    case 'trailing-slash':
      return `${withoutSlash}/`;
    case 'no-trailing-slash':
      return withoutSlash;
    case 'exact':
    default:
      return base;
  }
}

export function buildAuthorizeUrl(params: AuthorizeParams): URL {
  const url = new URL(params.authorizationEndpoint);
  const q = url.searchParams;

  q.set('response_type', 'code');
  q.set('client_id', params.config.clientId);
  q.set('redirect_uri', params.redirectUri);
  q.set('scope', params.scopesOverride ?? params.config.scopes);
  q.set('state', params.state);

  const aud = audValue(params.audienceOverride ?? params.config.fhirBaseUrl, params.config.audMode);
  if (aud) q.set('aud', aud);

  q.set('code_challenge', params.pkce.challenge);
  q.set('code_challenge_method', params.pkce.method);

  // Only meaningful with openid, and a nonce without an ID token to bind it
  // to is noise.
  if (params.nonce) q.set('nonce', params.nonce);

  if (params.launch) q.set('launch', params.launch);

  // NOTE: client_secret is deliberately NOT sent here. The Angular app put
  // it in customParamsAuthRequest, which is not a valid authorize parameter
  // and leaked the secret into the URL, browser history, referrers and the
  // identity provider's access logs.

  return url;
}

/** The parameters, for previewing the request before navigating. */
export function describeAuthorizeUrl(url: URL): { name: string; value: string }[] {
  return [...url.searchParams.entries()].map(([name, value]) => ({ name, value }));
}
