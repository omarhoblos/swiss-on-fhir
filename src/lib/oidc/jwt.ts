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
 * JWT decoding, replacing the jwt-decode dependency.
 *
 * Decoding only -- no signature verification. As an OAuth client we are not
 * required to validate the access token at all (it is opaque to us by spec,
 * and its audience is the FHIR server). The ID token IS checked, at sign-in,
 * by `checkIdToken` in ./id-token.ts, and the result is shown beside it.
 * That check is a finding, not a gate: the claims here are still decoded
 * and displayed whatever it said, because showing a bad token is the point.
 */

export class JwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwtError';
  }
}

export interface JwtHeader {
  alg?: string;
  typ?: string;
  kid?: string;
  [key: string]: unknown;
}

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  /** SMART launch context claims, when the token happens to be a JWT. */
  patient?: string;
  encounter?: string;
  fhirUser?: string;
  scope?: string;
  [key: string]: unknown;
}

function decodeSegment(segment: string, what: string): unknown {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new JwtError(`The ${what} is not valid base64url.`);
  }
  // Decode as UTF-8 rather than trusting atob's latin1 output: a naive
  // atob mangles non-ASCII claims, such as a name in fhirUser.
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new JwtError(`The ${what} is not valid JSON.`);
  }
}

/** True when a string looks like a three-segment JWS compact serialization. */
export function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3;
}

export function decodeJwtHeader(token: string): JwtHeader {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0]) {
    throw new JwtError('Not a JWS compact serialization (expected three dot-separated segments).');
  }
  return decodeSegment(parts[0], 'JWT header') as JwtHeader;
}

export function decodeJwt<T = JwtClaims>(token: string): T {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new JwtError('Not a JWS compact serialization (expected three dot-separated segments).');
  }
  return decodeSegment(parts[1], 'JWT payload') as T;
}

/** Decodes without throwing, for display of a possibly-opaque token. */
export function tryDecodeJwt(token: string): { header: JwtHeader; claims: JwtClaims } | null {
  try {
    return { header: decodeJwtHeader(token), claims: decodeJwt(token) };
  } catch {
    return null;
  }
}
