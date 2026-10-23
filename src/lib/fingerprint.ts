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
 * A short, stable fingerprint of a string: 32-bit FNV-1a, in base 36.
 *
 * A change detector, not a security boundary, in the spirit of
 * `authFingerprint`: it tells two tabs they hold the same refresh token, and
 * a callback that the client secret changed, without either value being
 * sent or stored again. Synchronous and non-cryptographic on purpose:
 * `crypto.subtle` exists only in a secure context, and Swiss also runs over
 * plain http. Being 32 bits, it does not hide a short value from someone who
 * can already read this origin's storage -- who can read the value itself.
 */
export function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}
