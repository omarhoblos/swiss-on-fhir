import { tryDecodeJwt, type JwtClaims } from '$lib/oidc/jwt';
import type { ContextSource, ContextValue, LaunchContext, SmartTokenResponse } from './types';

/**
 * Resolves SMART launch context from a token response.
 *
 * Resolution order is the INVERSE of the Angular app's, which read `patient`
 * by JWT-decoding the access token and nothing else. Per spec the access
 * token is opaque to the client, so that only worked by accident on servers
 * that happen to issue JWTs -- and it read `encounter` and `fhirUser` not at
 * all, despite requesting the `fhirUser` scope.
 *
 * Correct order: the token response is authoritative; the ID token is a
 * legitimate fallback; an access-token claim is a last resort and clearly
 * labelled as non-normative.
 */

const KNOWN_TOKEN_FIELDS = new Set([
  'access_token',
  'token_type',
  'expires_in',
  'scope',
  'refresh_token',
  'id_token',
  'patient',
  'encounter',
  'fhirUser',
  'need_patient_banner',
  'smart_style_url',
  'intent'
]);

function pick(candidates: { value: unknown; source: ContextSource }[]): ContextValue {
  const found = candidates.filter(
    (c): c is { value: string; source: ContextSource } =>
      typeof c.value === 'string' && c.value.length > 0
  );

  const first = found[0];
  if (!first) return { source: 'none' };

  // A disagreement between sources is a server bug the user needs to see,
  // not something to quietly resolve.
  const conflicting = found.slice(1).find((c) => c.value !== first.value);

  return {
    value: first.value,
    source: first.source,
    conflict: conflicting ? { value: conflicting.value, source: conflicting.source } : undefined
  };
}

export function resolveLaunchContext(tokens: SmartTokenResponse): LaunchContext {
  const idClaims: JwtClaims = tokens.id_token ? (tryDecodeJwt(tokens.id_token)?.claims ?? {}) : {};
  const accessClaims: JwtClaims = tryDecodeJwt(tokens.access_token)?.claims ?? {};

  const patient = pick([
    { value: tokens.patient, source: 'token-response' },
    { value: idClaims.patient, source: 'id-token' },
    { value: accessClaims.patient, source: 'access-token' }
  ]);

  const encounter = pick([
    { value: tokens.encounter, source: 'token-response' },
    { value: idClaims.encounter, source: 'id-token' },
    { value: accessClaims.encounter, source: 'access-token' }
  ]);

  // fhirUser is defined as an ID token claim (requiring the fhirUser scope
  // alongside openid), so the ID token comes first here. Some servers also
  // echo it in the token response; accept either.
  const fhirUser = pick([
    { value: idClaims.fhirUser, source: 'id-token' },
    { value: tokens.fhirUser, source: 'token-response' },
    { value: accessClaims.fhirUser, source: 'access-token' }
  ]);

  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (!KNOWN_TOKEN_FIELDS.has(key)) extras[key] = value;
  }

  return {
    patient,
    encounter,
    fhirUser,
    // Boolean by spec, but some servers send the string "true".
    needPatientBanner: coerceLooseBoolean(tokens.need_patient_banner),
    smartStyleUrl: typeof tokens.smart_style_url === 'string' ? tokens.smart_style_url : undefined,
    intent: typeof tokens.intent === 'string' ? tokens.intent : undefined,
    extras
  };
}

function coerceLooseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return undefined;
}

/** Resource types `fhirUser` is permitted to point at. */
export const FHIR_USER_TYPES = [
  'Patient',
  'Practitioner',
  'PractitionerRole',
  'RelatedPerson',
  'Person'
] as const;

export interface FhirUserReference {
  raw: string;
  resourceType: string;
  id: string;
  /** Absolute when the server returned a full URL. */
  absolute: boolean;
  /** True when it points at a different origin than the FHIR base. */
  crossOrigin: boolean;
  /** Set when the type is outside the spec-permitted set. */
  unexpectedType?: string;
  url: string;
}

export function parseFhirUser(raw: string, fhirBaseUrl: string): FhirUserReference | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const absolute = /^https?:\/\//i.test(trimmed);
  const relative = absolute ? new URL(trimmed).pathname.replace(/^\/+/, '') : trimmed;

  const parts = relative.split('/').filter(Boolean);
  const id = parts.pop();
  const resourceType = parts.pop();
  if (!id || !resourceType) return null;

  let crossOrigin = false;
  if (absolute) {
    try {
      crossOrigin = new URL(trimmed).origin !== new URL(fhirBaseUrl).origin;
    } catch {
      crossOrigin = true;
    }
  }

  const permitted = (FHIR_USER_TYPES as readonly string[]).includes(resourceType);

  return {
    raw: trimmed,
    resourceType,
    id,
    absolute,
    crossOrigin,
    unexpectedType: permitted ? undefined : resourceType,
    url: absolute ? trimmed : `${fhirBaseUrl.replace(/\/+$/, '')}/${resourceType}/${id}`
  };
}
