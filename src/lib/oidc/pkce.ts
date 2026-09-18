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
 * PKCE, generated explicitly so the values can be shown in the UI.
 *
 * The Angular app never configured PKCE at all -- it got whatever
 * angular-auth-oidc-client happened to default to, which meant there was no
 * way to see the verifier or challenge, and no way to test a server that
 * handles them incorrectly.
 */

export class InsecureContextError extends Error {
  constructor(origin: string) {
    super(
      `crypto.subtle is unavailable because ${origin} is not a secure context, so the PKCE S256 challenge cannot be computed. ` +
        `http://localhost and http://127.0.0.1 count as secure contexts; http://<lan-ip> does not.`
    );
    this.name = 'InsecureContextError';
  }
}

export type PkceMethod = 'S256' | 'plain';

export interface Pkce {
  method: PkceMethod;
  verifier: string;
  challenge: string;
}

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of u8) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 32 random bytes -> 43 base64url characters, which is the RFC 7636 minimum
 * verifier length (and the maximum is 128, so this is comfortably valid).
 */
export function randomUrlSafe(byteLength = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function challengeS256(verifier: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    // This is a likely failure, not a theoretical one: the Swiss 2.x README
    // told users to run on http://yourlocalip:4200, which is exactly the
    // case where crypto.subtle is undefined.
    throw new InsecureContextError(
      typeof location === 'undefined' ? 'this origin' : location.origin
    );
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

export async function createPkce(method: PkceMethod = 'S256'): Promise<Pkce> {
  const verifier = randomUrlSafe(32);
  if (method === 'plain') {
    // Forbidden by SMART 2.0, but a test tool needs to be able to send it.
    return { method, verifier, challenge: verifier };
  }
  return { method, verifier, challenge: await challengeS256(verifier) };
}

export function canUseS256(): boolean {
  return Boolean(globalThis.crypto?.subtle);
}
