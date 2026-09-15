/**
 * The effective configuration the auth and FHIR layers consume.
 *
 * Only six of these are `.env`-backed (see fields.ts). The rest are in-app
 * only, because they are per-experiment rather than per-deployment: you flip
 * them while probing a server, not when you deploy Swiss.
 *
 * Note the naming: `authIssuer` is the OAuth authorization server, and
 * `fhirBaseUrl` is the FHIR server. The Angular app called the former
 * `issuer`, which collides badly with SMART's `iss` launch parameter -- in an
 * EHR launch, `iss` is the FHIR base URL, not the authorization server. Never
 * say "issuer" unqualified.
 */
export interface AppConfig {
  // --- .env-backed ---
  /** Base URL of the FHIR server. `FHIRENDPOINT_URI`. */
  fhirBaseUrl: string;
  /** Base URL of the OAuth2/OIDC authorization server. `ISSUER_URI`. */
  authIssuer: string;
  /** OAuth2 client id. `CLIENT_ID`. */
  clientId: string;
  /** Optional client secret; empty means a public client. `CLIENT_SECRET`. */
  clientSecret: string;
  /** Space-delimited requested scopes. `SCOPES`. */
  scopes: string;
  /** Disable the OIDC issuer-match check. `SKIP_ISSUER_CHECK`. */
  skipIssuerCheck: boolean;

  // --- in-app only ---
  /** How to present client credentials at the token endpoint. */
  clientAuthMethod: ClientAuthMethod;
  /** How to send the SMART `aud` parameter on the authorize request. */
  audMode: AudMode;
  /** Which SMART scope syntax the scope picker offers by default. */
  scopeSyntax: ScopeSyntax;
  /** Where to keep tokens. */
  tokenStorage: StorageMode;
  /** Mask secrets in the exchange log and diagnostics exports. */
  redactSecrets: boolean;
}

/**
 * `basic` and `body` both exist because servers genuinely differ and a test
 * tool needs to try either. RFC 6749 prefers Basic for confidential clients;
 * the Angular app used the body form, so it stays supported.
 */
export type ClientAuthMethod = 'none' | 'basic' | 'body';

/**
 * SMART requires `aud` on the authorize request and it must match the FHIR
 * base. Servers disagree about trailing slashes, and some reject an `aud`
 * they do not recognise -- so this is a knob, not a constant.
 */
export type AudMode = 'exact' | 'trailing-slash' | 'no-trailing-slash' | 'omit';

/** SMART 1.0 uses `.read`/`.write`; SMART 2.0 uses `.rs`/`.cruds`. */
export type ScopeSyntax = 'auto' | 'v1' | 'v2';

export type StorageMode = 'memory' | 'session' | 'local';

/** Which layer supplied the value currently in effect for a field. */
export type ConfigSource = 'default' | 'runtime' | 'override' | 'launch';

/** A partial set of config values, as each layer contributes. */
export type ConfigLayer = Partial<AppConfig>;

export type Severity = 'error' | 'warning' | 'info';

export interface ConfigIssue {
  /** The field this concerns, or `null` for whole-file problems. */
  key: keyof AppConfig | null;
  severity: Severity;
  message: string;
  /** Present for a deprecated or unknown key we parsed but ignored. */
  ignoredKey?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}
