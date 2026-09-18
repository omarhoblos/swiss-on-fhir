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

/**
 * Where a discovered value came from.
 *
 * Provenance is tracked on every endpoint because when two documents
 * disagree, which one answered is exactly what the user needs to know. Swiss
 * never silently picks one and moves on.
 */
export type DiscoverySource =
  | 'manual'
  | 'ehr-launch-iss'
  | 'smart-configuration'
  | 'openid-configuration'
  | 'capability-statement';

export interface Sourced<T> {
  value: T;
  source: DiscoverySource;
  /** The URL that supplied it, which is itself diagnostic information. */
  from?: string;
}

export const ENDPOINT_KEYS = [
  'issuer',
  'authorization_endpoint',
  'token_endpoint',
  'revocation_endpoint',
  'introspection_endpoint',
  'management_endpoint',
  'registration_endpoint',
  'userinfo_endpoint',
  'jwks_uri',
  'end_session_endpoint'
] as const;

export type EndpointKey = (typeof ENDPOINT_KEYS)[number];

export type ResolvedEndpoints = Partial<Record<EndpointKey, Sourced<string>>>;

export interface EndpointConflict {
  key: EndpointKey;
  chosen: { source: DiscoverySource; value: string };
  others: { source: DiscoverySource; value: string }[];
  /** `info` for differences that cannot change behaviour (host case, :443). */
  severity: 'info' | 'warn';
}

/** https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html */
export interface SmartConfiguration {
  issuer?: string;
  jwks_uri?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  revocation_endpoint?: string;
  introspection_endpoint?: string;
  management_endpoint?: string;
  registration_endpoint?: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  grant_types_supported?: string[];
  scopes_supported?: string[];
  response_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
  /** SMART 2.0. */
  capabilities?: string[];
  /** SMART 1.0 spelling; accepted as an alias. */
  smart_capabilities?: string[];
  [key: string]: unknown;
}

export interface FeatureGate {
  /** `yes` supported, `not-advertised` silent, `no` explicitly contradicted. */
  state: 'yes' | 'not-advertised' | 'no';
  detail?: string;
}

/**
 * What the server says it can do.
 *
 * Policy throughout: ADVERTISE, DON'T BLOCK. Servers under-report constantly,
 * and a tool that refuses to send a request because a capability was not
 * listed is useless for finding out that the server actually supports it.
 * Only an explicit contradiction disables a control, and even then behind an
 * override.
 */
export interface SmartFeatureGates {
  launchStandalone: FeatureGate;
  launchEhr: FeatureGate;
  clientPublic: FeatureGate;
  clientConfidentialSymmetric: FeatureGate;
  clientConfidentialAsymmetric: FeatureGate;
  ssoOpenidConnect: FeatureGate;
  contextStandalonePatient: FeatureGate;
  contextEhrPatient: FeatureGate;
  permissionPatient: FeatureGate;
  permissionUser: FeatureGate;
  permissionSystem: FeatureGate;
  scopeSyntax: 'v1' | 'v2' | 'both' | 'unknown';
  pkceS256: FeatureGate;
  pkcePlain: FeatureGate;
  grantAuthorizationCode: FeatureGate;
  grantRefreshToken: FeatureGate;
  grantClientCredentials: FeatureGate;
  canRevoke: boolean;
  canIntrospect: boolean;
  canLogout: boolean;
  scopesSupported: string[] | null;
  tokenAuthMethodsSupported: string[] | null;
}

/** The SMART token response. */
export interface SmartTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  /** The GRANTED scope, which may differ from what was requested. */
  scope?: string;
  refresh_token?: string;
  id_token?: string;
  patient?: string;
  encounter?: string;
  fhirUser?: string;
  /** Boolean by spec, but some servers send the string "true". */
  need_patient_banner?: boolean | string;
  smart_style_url?: string;
  intent?: string;
  /**
   * Deliberately open: a diagnostic tool must display every field the server
   * sent, including ones it does not recognise.
   */
  [key: string]: unknown;
}

export type ContextSource = 'token-response' | 'id-token' | 'access-token' | 'none';

export interface ContextValue {
  value?: string;
  source: ContextSource;
  /** Set when two sources disagreed -- that is a server bug worth showing. */
  conflict?: { value: string; source: ContextSource };
}

export interface LaunchContext {
  patient: ContextValue;
  encounter: ContextValue;
  fhirUser: ContextValue;
  needPatientBanner?: boolean;
  smartStyleUrl?: string;
  intent?: string;
  /** Token-response parameters Swiss does not recognise. */
  extras: Record<string, unknown>;
}
