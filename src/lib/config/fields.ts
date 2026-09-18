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

import { coerceBoolean, coerceEnum, coerceScopes, coerceString, coerceUrl } from './coerce';
import type { AppConfig, Result } from './types';

/**
 * The field-spec table: one entry per config field, and the single source of
 * truth for coercion, validation, the /config form, and the README table.
 *
 * This is deliberately hand-rolled rather than a zod/valibot schema. A schema
 * gives us only the parsing; the form still needs a label, help text, an
 * input kind, and the auth-critical/secret flags, so a schema would mean
 * maintaining a parallel metadata table anyway. One table is less total code.
 */

export type FieldKind = 'url' | 'text' | 'boolean' | 'scopes' | 'secret' | 'enum';

export interface FieldSpec<K extends keyof AppConfig = keyof AppConfig> {
  key: K;
  /** The `.env` variable name, or `null` for in-app-only settings. */
  envKey: string | null;
  label: string;
  help: string;
  kind: FieldKind;
  /** Options, for `kind: 'enum'`. */
  options?: { value: string; label: string; help?: string }[];
  /**
   * Changing this invalidates an existing session, because tokens minted
   * under the old value are no longer the thing being tested.
   */
  authCritical: boolean;
  /**
   * Whether an empty string from the runtime file means "not provided"
   * (fall through to the default) or "explicitly empty" (stop here).
   *
   * This distinction is what makes removing a client secret actually work:
   * envsubst renders an unset variable as "", and for a URL that means
   * "unset, use the default", but for the secret it must mean "no secret".
   */
  emptyMeansUnset: boolean;
  parse(input: unknown): Result<AppConfig[K]>;
}

/**
 * Keys that were plumbed all the way from .env into environment.ts in v2 and
 * then read by absolutely nothing. Removed in 3.0. We still recognise them so
 * an existing .env produces one clear "safe to delete" note instead of an
 * "unknown key" warning, and never a failure -- every existing deployment has
 * these in its .env.
 */
export const REMOVED_KEYS: Record<string, string> = {
  redirectUri:
    'Removed in 3.0 -- the redirect URI is now derived as <origin>/callback and shown below. Safe to delete from your .env (REDIRECT_URI).',
  redirectUrl: 'Removed in 3.0 -- see redirectUri.',
  logoutUri:
    'Removed in 3.0 -- logout now uses end_session_endpoint and revocation_endpoint from discovery. Safe to delete from your .env (LOGOUT_URI).',
  requireHttps:
    'Removed in 3.0 -- plaintext http endpoints are now always flagged, so no toggle is needed. Safe to delete from your .env (ENABLE_HTTPS).',
  skipIssuerCheck:
    'Removed in 3.0 -- it only disabled a check in the Angular sign-in library, and Swiss 3 runs its own flow, which a mismatched issuer does not block. Diagnostics still reports the mismatch. Safe to delete from your .env (SKIP_ISSUER_CHECK).',
  strictDiscoveryDocumentValidation:
    'Removed in 2.0 and never reinstated. Safe to delete from your .env (STRICT_DISCOVERY_DOCUMENT_VALIDATION).',
  // The v2 runtime file used these names for what are now fhirBaseUrl and
  // authIssuer; accepted as aliases in runtime.ts, listed here for the docs.
  fhirEndpointUri: 'Renamed to fhirBaseUrl in 3.0; the FHIRENDPOINT_URI env var is unchanged.',
  issuer: 'Renamed to authIssuer in 3.0; the ISSUER_URI env var is unchanged.'
};

export const FIELDS: readonly FieldSpec[] = [
  {
    key: 'fhirBaseUrl',
    envKey: 'FHIRENDPOINT_URI',
    label: 'FHIR base URL',
    help: 'The FHIR server to query. Also sent as the SMART `aud` parameter on the authorize request.',
    kind: 'url',
    authCritical: false,
    emptyMeansUnset: true,
    parse: coerceUrl
  },
  {
    key: 'authIssuer',
    envKey: 'ISSUER_URI',
    label: 'Authorization server (issuer)',
    help: 'Base URL of the OAuth2/OIDC server. Discovery reads /.well-known/openid-configuration from here.',
    kind: 'url',
    authCritical: true,
    emptyMeansUnset: true,
    parse: coerceUrl
  },
  {
    key: 'clientId',
    envKey: 'CLIENT_ID',
    label: 'Client ID',
    help: 'Must match the client registered with your authorization server.',
    kind: 'text',
    authCritical: true,
    emptyMeansUnset: true,
    parse: coerceString
  },
  {
    key: 'clientSecret',
    envKey: 'CLIENT_SECRET',
    label: 'Client secret',
    help: 'Leave empty for a public client. Swiss always uses PKCE, so a browser app does not need a secret. A secret here is readable by anyone who opens devtools.',
    kind: 'secret',
    authCritical: true,
    // An empty secret means "public client", not "use the default".
    emptyMeansUnset: false,
    parse: coerceString
  },
  {
    key: 'scopes',
    envKey: 'SCOPES',
    label: 'Requested scopes',
    help: 'Space-delimited. SMART 1.0 (patient/*.read) and 2.0 (patient/*.rs) syntax are both accepted.',
    kind: 'scopes',
    authCritical: true,
    emptyMeansUnset: true,
    parse: coerceScopes
  },
  {
    key: 'clientAuthMethod',
    envKey: null,
    label: 'Client authentication',
    help: 'How to present credentials at the token endpoint. Auto-selected from the server’s advertised methods; override to test a specific one.',
    kind: 'enum',
    options: [
      { value: 'none', label: 'Public (PKCE only)', help: 'Recommended for a browser app.' },
      {
        value: 'basic',
        label: 'HTTP Basic',
        help: 'RFC 6749 preference for confidential clients.'
      },
      {
        value: 'body',
        label: 'Request body',
        help: 'client_secret as a form parameter, as Swiss 2.x did.'
      }
    ],
    authCritical: true,
    emptyMeansUnset: true,
    parse: coerceEnum(['none', 'basic', 'body'] as const)
  },
  {
    key: 'audMode',
    envKey: null,
    label: 'aud parameter',
    help: 'SMART requires `aud` to match the FHIR base, but servers disagree about trailing slashes and some reject an aud they do not recognise.',
    kind: 'enum',
    options: [
      { value: 'exact', label: 'Exactly as configured' },
      { value: 'trailing-slash', label: 'With a trailing slash' },
      { value: 'no-trailing-slash', label: 'Without a trailing slash' },
      {
        value: 'omit',
        label: 'Omit it entirely',
        help: 'Non-conformant; useful to confirm your server requires it.'
      }
    ],
    authCritical: false,
    emptyMeansUnset: true,
    parse: coerceEnum(['exact', 'trailing-slash', 'no-trailing-slash', 'omit'] as const)
  },
  {
    key: 'scopeSyntax',
    envKey: null,
    label: 'Scope syntax',
    help: 'Which SMART scope syntax the picker offers. Auto follows the server’s advertised permission-v1/permission-v2 capability.',
    kind: 'enum',
    options: [
      { value: 'auto', label: 'Auto (from capabilities)' },
      { value: 'v1', label: 'SMART 1.0 (.read / .write)' },
      { value: 'v2', label: 'SMART 2.0 (.rs / .cruds)' }
    ],
    authCritical: false,
    emptyMeansUnset: true,
    parse: coerceEnum(['auto', 'v1', 'v2'] as const)
  },
  {
    key: 'tokenStorage',
    envKey: null,
    label: 'Token storage',
    help: 'Session storage survives reloads and the OAuth redirect but dies with the tab. Local storage survives a browser restart, leaving tokens on disk.',
    kind: 'enum',
    options: [
      { value: 'session', label: 'Session storage (recommended)' },
      {
        value: 'local',
        label: 'Local storage',
        help: 'Survives restarts; tokens persist on disk.'
      },
      { value: 'memory', label: 'Memory only', help: 'Safest, but a reload loses the session.' }
    ],
    authCritical: false,
    emptyMeansUnset: true,
    parse: coerceEnum(['session', 'local', 'memory'] as const)
  },
  {
    key: 'redactSecrets',
    envKey: null,
    label: 'Redact secrets in logs',
    help: 'Masks the client secret, code verifier, refresh token and Authorization headers in the exchange log and diagnostics exports, so a report is safe to paste into an issue.',
    kind: 'boolean',
    authCritical: false,
    emptyMeansUnset: true,
    parse: coerceBoolean
  }
] as const;

export const FIELDS_BY_KEY = new Map<keyof AppConfig, FieldSpec>(FIELDS.map((f) => [f.key, f]));

/** Fields whose change invalidates an existing session. */
export const AUTH_CRITICAL_KEYS: readonly (keyof AppConfig)[] = FIELDS.filter(
  (f) => f.authCritical
).map((f) => f.key);

/** Fields that come from `.env` (and so appear in the runtime config file). */
export const ENV_BACKED_FIELDS: readonly FieldSpec[] = FIELDS.filter((f) => f.envKey !== null);

export function fieldSpec(key: keyof AppConfig): FieldSpec {
  const spec = FIELDS_BY_KEY.get(key);
  if (!spec) throw new Error(`No field spec for config key "${key}"`);
  return spec;
}
