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
 * Decides whether a string is safe to put in an `href`.
 *
 * Every URL Swiss displays came from a document or a server it does not
 * control, so an `<a href>` built blindly from one would either do nothing or,
 * for a `javascript:` value, be an injection.
 *
 * Returns the ORIGINAL string rather than the parsed `href`. The parse is a
 * validity and scheme gate only: `new URL()` normalises, so a bare origin
 * comes back with a trailing slash and the link would point somewhere other
 * than the text beside it. Swiss exists to show exactly what a server said,
 * and a trailing slash is the kind of difference it is meant to expose rather
 * than tidy away.
 */
export function httpUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/** Groups URLs by host, so an origin that cannot be reached is tried once. */
export function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
