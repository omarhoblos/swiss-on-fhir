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

import { originOf } from '$lib/url';
import { fhirRequest } from './client';

/** Longest name shown; the rest of a runaway title is cut with an ellipsis. */
const MAX_NAME_LENGTH = 120;

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * What a CapabilityStatement says the server is called: `software.name`
 * followed by `software.version` when it has a software name, and its
 * `title` only when it does not. Null when it says neither, since a version
 * on its own names nothing.
 *
 * Server text is input: only strings are read, whitespace is collapsed, and
 * the result is capped.
 */
export function serverNameFrom(capabilityStatement: unknown): string | null {
  if (typeof capabilityStatement !== 'object' || capabilityStatement === null) return null;
  const cs = capabilityStatement as Record<string, unknown>;

  const software =
    typeof cs.software === 'object' && cs.software !== null
      ? (cs.software as Record<string, unknown>)
      : {};
  const name = text(software.name);
  const version = text(software.version);
  const found = name ? (version ? `${name} ${version}` : name) : text(cs.title);
  if (!found) return null;

  return found.length > MAX_NAME_LENGTH ? `${found.slice(0, MAX_NAME_LENGTH - 1)}…` : found;
}

/** The Request card's title for a server name, or plain "Request" without one. */
export function requestTitle(serverName: string | null): string {
  return serverName ? `Request to server: ${serverName}` : 'Request';
}

/**
 * The FHIR base of an absolute URL typed into the request bar: everything
 * before the first part that is a resource type, an operation, a `_` path
 * such as `_history`, or `metadata`. `https://server.fire.ly/r4/Patient/1`
 * gives `https://server.fire.ly/r4`. Resource types are the only path parts
 * FHIR capitalises, so a base's own path (`/fhir`, `/baseR4`) is kept.
 * Null for anything that is not an http(s) URL.
 */
export function fhirBaseOf(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const kept: string[] = [];
  for (const part of url.pathname.split('/').filter(Boolean)) {
    if (/^[A-Z$_]/.test(part) || part === 'metadata') break;
    kept.push(part);
  }
  return kept.length ? `${url.origin}/${kept.join('/')}` : url.origin;
}

/**
 * The FHIR base a request-bar entry goes to: `base` for a relative path or
 * a URL under it, and the typed URL's own base for one on another server.
 */
export function requestBaseOf(query: string, base: string): string {
  const typed = query.trim();
  if (!/^https?:\/\//i.test(typed) || !base) return base;
  const trimmed = base.replace(/\/+$/, '');
  const under = typed === trimmed || /^[/?#]/.test(typed.slice(trimmed.length));
  if (typed.startsWith(trimmed) && under) return base;
  return fhirBaseOf(typed) ?? base;
}

/** Names already read, per FHIR base and whether a token was sent. */
const known = new Map<string, string | null>();

/**
 * Reads the server's CapabilityStatement (`/metadata`) for its name.
 *
 * Through `fhirRequest`, so it is logged like any other request. The token
 * goes only to `tokenBase`'s origin, the server it was issued for; another
 * server is asked anonymously. A summary is enough: `title` and `software`
 * are both summary elements. Only an answer is remembered, so a server
 * that was down is asked again next time.
 */
export async function readServerName(options: {
  base: string;
  tokenBase: string;
  accessToken: string | null | undefined;
  signal: AbortSignal;
}): Promise<string | null> {
  const { base, tokenBase, accessToken, signal } = options;
  const withToken = Boolean(accessToken) && originOf(base) === originOf(tokenBase);
  const key = `${base}\n${withToken ? 'token' : 'anonymous'}`;
  if (known.has(key)) return known.get(key) ?? null;

  try {
    const result = await fhirRequest({
      method: 'GET',
      query: 'metadata?_summary=true',
      base,
      tokenBase,
      accessToken,
      authorize: withToken,
      signal
    });
    if (signal.aborted || !result.ok) return null;
    const name = serverNameFrom(result.json);
    known.set(key, name);
    return name;
  } catch {
    return null;
  }
}
