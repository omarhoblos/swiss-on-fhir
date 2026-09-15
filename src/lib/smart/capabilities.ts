import { readCapabilities } from './discovery';
import type { FeatureGate, SmartConfiguration, SmartFeatureGates } from './types';

/**
 * Turns a smart-configuration document into UI feature gates.
 *
 * Policy: ADVERTISE, DON'T BLOCK. Three states per gate --
 *
 *   yes            explicitly advertised
 *   not-advertised silent about it; we proceed anyway and say so
 *   no             explicitly contradicted
 *
 * Only `no` should disable a control, and even then behind an override.
 * Servers under-report their capabilities constantly, and a tool that refuses
 * to send a request because a capability was not listed cannot discover that
 * the server actually supports it -- which is the whole job.
 */

function gateFromList(
  list: string[] | null,
  wanted: string,
  detailWhenMissing: string
): FeatureGate {
  if (list === null) return { state: 'not-advertised', detail: detailWhenMissing };
  if (list.includes(wanted)) return { state: 'yes' };
  return { state: 'no', detail: `The server advertises capabilities but not "${wanted}".` };
}

export function deriveFeatureGates(doc: SmartConfiguration | undefined): SmartFeatureGates {
  const caps = readCapabilities(doc);
  const capDetail =
    'The server does not publish a capabilities list, so this could not be confirmed either way.';

  const pkceMethods = arrayOf(doc?.code_challenge_methods_supported);
  const grants = arrayOf(doc?.grant_types_supported);
  const scopes = arrayOf(doc?.scopes_supported);
  const authMethods = arrayOf(doc?.token_endpoint_auth_methods_supported);

  const permissionV1 = caps?.includes('permission-v1') ?? false;
  const permissionV2 = caps?.includes('permission-v2') ?? false;

  return {
    launchStandalone: gateFromList(caps, 'launch-standalone', capDetail),
    launchEhr: gateFromList(caps, 'launch-ehr', capDetail),
    clientPublic: gateFromList(caps, 'client-public', capDetail),
    clientConfidentialSymmetric: gateFromList(caps, 'client-confidential-symmetric', capDetail),
    clientConfidentialAsymmetric: gateFromList(caps, 'client-confidential-asymmetric', capDetail),
    ssoOpenidConnect: gateFromList(caps, 'sso-openid-connect', capDetail),
    contextStandalonePatient: gateFromList(caps, 'context-standalone-patient', capDetail),
    contextEhrPatient: gateFromList(caps, 'context-ehr-patient', capDetail),
    permissionPatient: gateFromList(caps, 'permission-patient', capDetail),
    permissionUser: gateFromList(caps, 'permission-user', capDetail),
    permissionSystem: gateFromList(caps, 'permission-v2', capDetail),

    scopeSyntax:
      permissionV1 && permissionV2 ? 'both' : permissionV2 ? 'v2' : permissionV1 ? 'v1' : 'unknown',

    pkceS256:
      pkceMethods === null
        ? {
            state: 'not-advertised',
            detail:
              'code_challenge_methods_supported is absent. SMART 2.0 requires S256, so Swiss sends it anyway.'
          }
        : pkceMethods.includes('S256')
          ? { state: 'yes' }
          : {
              state: 'no',
              detail: `The server advertises only ${pkceMethods.join(', ')}. SMART 2.0 requires S256.`
            },

    pkcePlain:
      pkceMethods === null
        ? { state: 'not-advertised' }
        : pkceMethods.includes('plain')
          ? { state: 'yes', detail: 'plain is forbidden by SMART 2.0 but accepted here.' }
          : { state: 'no' },

    grantAuthorizationCode: gateFromList(
      grants,
      'authorization_code',
      'grant_types_supported is absent; Swiss assumes authorization_code is available.'
    ),
    grantRefreshToken: gateFromList(
      grants,
      'refresh_token',
      'grant_types_supported is absent, so refresh support is unknown until you try it.'
    ),
    grantClientCredentials: gateFromList(
      grants,
      'client_credentials',
      'grant_types_supported is absent, so backend-services support is unknown.'
    ),

    canRevoke: typeof doc?.revocation_endpoint === 'string',
    canIntrospect: typeof doc?.introspection_endpoint === 'string',
    canLogout: typeof doc?.end_session_endpoint === 'string',

    scopesSupported: scopes,
    tokenAuthMethodsSupported: authMethods
  };
}

function arrayOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Picks a client-auth method from what the server advertises, with the
 * reasoning so the UI can explain itself rather than silently choosing.
 */
export function suggestClientAuthMethod(
  gates: SmartFeatureGates,
  hasSecret: boolean
): { method: 'none' | 'basic' | 'body'; reason: string } {
  if (!hasSecret) {
    return {
      method: 'none',
      reason: 'No client secret is configured, so Swiss uses a public client with PKCE.'
    };
  }
  const methods = gates.tokenAuthMethodsSupported;
  if (methods === null) {
    return {
      method: 'basic',
      reason:
        'The server does not advertise token_endpoint_auth_methods_supported. HTTP Basic is the RFC 6749 preference, so Swiss starts there.'
    };
  }
  if (methods.includes('client_secret_basic')) {
    return { method: 'basic', reason: 'The server advertises client_secret_basic.' };
  }
  if (methods.includes('client_secret_post')) {
    return { method: 'body', reason: 'The server advertises client_secret_post.' };
  }
  if (methods.includes('none')) {
    return {
      method: 'none',
      reason:
        'The server advertises only "none" for token endpoint auth, so the secret would be rejected.'
    };
  }
  return {
    method: 'basic',
    reason: `The server advertises ${methods.join(', ')}, none of which Swiss sends directly. Falling back to HTTP Basic.`
  };
}
