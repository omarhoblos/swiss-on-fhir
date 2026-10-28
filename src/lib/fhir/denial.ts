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

import type { HttpExchange } from '#lib/http/exchange.ts';
import type { LaunchType } from '#lib/environments/types.ts';
import {
  parseScopes,
  type FhirOperation,
  type FhirScope,
  type GrantedScopes
} from '#lib/smart/scopes.ts';
import type { FhirMethod } from './client';

/**
 * Why a FHIR request was refused, as far as the client can tell.
 *
 * A 401 or 403 from the FHIR server is often the first sign that a token
 * carries less than it says: a client registration missing the scopes it
 * asked for still gets a token, and the token response may simply repeat the
 * request. So the console compares what the request needs with what the
 * session holds, and reads the server's `WWW-Authenticate` challenge when the
 * browser lets it. The result is a hint, never a verdict: the server's own
 * access rules are invisible from here.
 */

/** What SMART calls each operation letter, for the hint's text. */
const OPERATION_NAMES: Record<FhirOperation, string> = {
  c: 'create',
  r: 'read',
  u: 'update',
  d: 'delete',
  s: 'search'
};

/** The SMART v1 suffix that grants each operation. */
const V1_SUFFIX: Record<FhirOperation, 'read' | 'write'> = {
  c: 'write',
  r: 'read',
  u: 'write',
  d: 'write',
  s: 'read'
};

/** A request's need, in scope terms, or why it has none that scopes can name. */
export type RequestNeed =
  { kind: 'resource'; resource: string; op: FhirOperation } | { kind: 'unknown'; reason: string };

const RESOURCE_TYPE = /^[A-Z][A-Za-z]+$/;

/**
 * The resource type and operation a FHIR REST request needs a scope for.
 *
 * Read from the path below the FHIR base. Operations (`$everything`), batches
 * and system-level calls are `unknown`: SMART does not say which scopes they
 * take, and each server decides.
 */
export function requestNeed(method: FhirMethod, url: string, base: string): RequestNeed {
  let target: URL;
  let baseUrl: URL;
  try {
    target = new URL(url);
    baseUrl = new URL(base);
  } catch {
    return { kind: 'unknown', reason: 'The request URL could not be read.' };
  }

  const basePath = baseUrl.pathname.replace(/\/+$/, '');
  if (target.origin !== baseUrl.origin || !isUnder(target.pathname, basePath)) {
    return { kind: 'unknown', reason: 'The request went outside the FHIR base.' };
  }
  const segments = target.pathname
    .slice(basePath.length)
    .split('/')
    .filter(Boolean)
    .map((s) => safeDecode(s));

  const [type, second, third, fourth] = segments;
  if (!type) {
    return {
      kind: 'unknown',
      reason:
        method === 'POST'
          ? 'A batch or transaction: each entry needs its own scope.'
          : 'A system-level request, which no resource scope names.'
    };
  }
  if (type.startsWith('$')) {
    return {
      kind: 'unknown',
      reason: `\`${type}\` is an operation, and SMART does not say which scopes an operation needs.`
    };
  }
  if (!RESOURCE_TYPE.test(type)) {
    return { kind: 'unknown', reason: 'A system-level request, which no resource scope names.' };
  }
  const need = (resource: string, op: FhirOperation): RequestNeed => ({
    kind: 'resource',
    resource,
    op
  });
  const operation = (name: string): RequestNeed => ({
    kind: 'unknown',
    reason: `\`${name}\` is an operation, and SMART does not say which scopes an operation needs.`
  });

  if (segments.length === 1) {
    if (method === 'GET') return need(type, 's');
    if (method === 'POST') return need(type, 'c');
    // Conditional update and delete, by search parameters.
    if (method === 'DELETE') return need(type, 'd');
    return need(type, 'u');
  }

  if (segments.length === 2 && second) {
    if (second === '_search') return need(type, 's');
    if (second === '_history') return need(type, 'r');
    if (second.startsWith('$')) return operation(second);
    if (method === 'GET') return need(type, 'r');
    if (method === 'PUT' || method === 'PATCH') return need(type, 'u');
    if (method === 'DELETE') return need(type, 'd');
    return { kind: 'unknown', reason: 'A POST to a resource id is not a FHIR REST interaction.' };
  }

  if (third?.startsWith('$')) return operation(third);
  if (third === '_history') return need(type, 'r');
  // Patient/123/Observation: a compartment search for Observations.
  if (third && RESOURCE_TYPE.test(third) && (segments.length === 3 || fourth === '_search')) {
    return need(third, 's');
  }
  return { kind: 'unknown', reason: 'The path is not one Swiss can map to a resource scope.' };
}

function isUnder(path: string, basePath: string): boolean {
  return path === basePath || path.startsWith(`${basePath}/`);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The parameters of a `Bearer` challenge (RFC 6750 section 3). */
export interface BearerChallenge {
  error?: string;
  errorDescription?: string;
  scope?: string;
  realm?: string;
}

/**
 * Reads the `Bearer` challenge out of a `WWW-Authenticate` value.
 *
 * The header can hold several challenges (`Bearer ..., Basic realm="x"`), each
 * with comma-separated parameters whose quoted values may themselves contain
 * commas. Returns null when there is no Bearer challenge.
 */
export function parseBearerChallenge(header: string): BearerChallenge | null {
  const tokens = tokenizeChallenges(header);
  let inBearer = false;
  let found = false;
  const params = new Map<string, string>();
  for (const token of tokens) {
    if (token.kind === 'scheme') {
      if (found) break;
      inBearer = token.value.toLowerCase() === 'bearer';
      found = inBearer;
      continue;
    }
    if (inBearer && !params.has(token.name)) params.set(token.name, token.value);
  }
  if (!found) return null;
  return {
    error: params.get('error'),
    errorDescription: params.get('error_description'),
    scope: params.get('scope'),
    realm: params.get('realm')
  };
}

type ChallengeToken =
  { kind: 'scheme'; value: string } | { kind: 'param'; name: string; value: string };

function tokenizeChallenges(header: string): ChallengeToken[] {
  const out: ChallengeToken[] = [];
  let i = 0;
  const skip = (pattern: RegExp) => {
    while (i < header.length && pattern.test(header[i] ?? '')) i++;
  };
  const word = () => {
    const start = i;
    while (i < header.length && /[^\s,=]/.test(header[i] ?? '')) i++;
    return header.slice(start, i);
  };

  while (i < header.length) {
    skip(/[\s,]/);
    if (i >= header.length) break;
    const name = word();
    if (!name) {
      i++;
      continue;
    }
    skip(/\s/);
    if (header[i] !== '=') {
      // A scheme name, possibly followed by a token68 that is not a parameter.
      out.push({ kind: 'scheme', value: name });
      continue;
    }
    i++;
    skip(/\s/);
    let value = '';
    if (header[i] === '"') {
      i++;
      while (i < header.length && header[i] !== '"') {
        if (header[i] === '\\' && i + 1 < header.length) i++;
        value += header[i];
        i++;
      }
      i++;
    } else {
      value = word();
    }
    out.push({ kind: 'param', name: name.toLowerCase(), value });
  }
  return out;
}

/**
 * How the request was authenticated, as the console sent it. `withheld` is a
 * token kept back because the request went to another origin.
 */
export type SentCredential = 'session-token' | 'own-header' | 'withheld' | 'none';

export interface DenialInput {
  exchange: HttpExchange;
  method: FhirMethod;
  /** The FHIR base the request resolved against. */
  base: string;
  credential: SentCredential;
  /** What the session holds, or null without a session. */
  granted: GrantedScopes | null;
  launchType: LaunchType | null;
  /** The patient in context, for a patient/ scope's compartment. */
  patient: string | null;
  /** The session's token was past its expiry when the request went. */
  expired: boolean;
}

export interface DenialHint {
  title: string;
  /** Markdown, each one a paragraph. */
  points: string[];
  challenge: BearerChallenge | null;
}

/** Long or awkward server text, made safe to show inside a code span. */
function shown(value: string, max = 300): string {
  const flat = value.replace(/`/g, "'").replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * A hint for a 401 or 403, or null for any other response.
 */
export function explainDenial(input: DenialInput): DenialHint | null {
  const status = input.exchange.response?.status;
  if (status !== 401 && status !== 403) return null;

  const header = input.exchange.response?.headers['www-authenticate'];
  const challenge = header ? parseBearerChallenge(header) : null;
  // The challenge comes last: what the client can see about its own token
  // is the more useful line, and the challenge often just repeats it.
  const challengeLines = challengePoints(status, header, challenge, input.exchange);

  if (input.credential === 'none') {
    return {
      title: 'No access token went with this request',
      points: [
        input.granted
          ? 'Authorization is switched off for this request, so the server saw no token: the refusal says nothing about scopes.'
          : 'There is no session, so the server saw no token: the refusal says nothing about scopes.',
        ...challengeLines
      ],
      challenge
    };
  }
  if (input.credential === 'withheld') {
    let origin = 'This server';
    try {
      origin = `\`${new URL(input.exchange.request.url).origin}\``;
    } catch {
      /* named generically */
    }
    return {
      title: 'The token was not sent to this server',
      points: [
        `${origin} is not the FHIR base the session’s token was issued for, so the token was kept back and the server saw none.`,
        ...challengeLines
      ],
      challenge
    };
  }
  if (input.credential === 'own-header') {
    return {
      title: 'Your own Authorization header was sent',
      points: [
        'The request carried the Authorization header you added, not the session’s token, so the session’s scopes say nothing about this refusal.',
        ...challengeLines
      ],
      challenge
    };
  }

  const points: string[] = [];
  if (status === 401) {
    points.push(
      input.expired
        ? 'The token had expired when this request went. Refresh it, or sign in again.'
        : 'A 401 means the server did not accept the token at all: expired, revoked, issued for another server (its `aud`), or from an issuer it does not trust. Missing scopes are normally a 403.'
    );
  }
  if (input.granted) {
    points.push(
      ...scopePoints(requestNeed(input.method, input.exchange.request.url, input.base), input)
    );
  }
  points.push(...challengeLines);
  return { title: titleFor(status), points, challenge };
}

function titleFor(status: 401 | 403): string {
  return status === 401
    ? 'The server did not accept the token'
    : 'The server refused this request for this token';
}

function challengePoints(
  status: 401 | 403,
  header: string | undefined,
  challenge: BearerChallenge | null,
  exchange: HttpExchange
): string[] {
  if (!header) {
    // Cross-origin, a header the server sends is invisible unless listed in
    // Access-Control-Expose-Headers, and Swiss cannot tell the two apart.
    return exchange.response?.unreadableHeaders?.includes('www-authenticate')
      ? [
          'No `WWW-Authenticate` header could be read. Either the server sent none, or it did not list it in `Access-Control-Expose-Headers`, so the browser hid it.'
        ]
      : [];
  }
  if (!challenge) {
    return [`\`WWW-Authenticate\` has no Bearer challenge: \`${shown(header)}\`.`];
  }
  const out: string[] = [];
  if (challenge.error) {
    const description = challenge.errorDescription
      ? ` (\`${shown(challenge.errorDescription)}\`)`
      : '';
    out.push(
      `The server’s challenge says \`error="${shown(challenge.error, 80)}"\`${description}.`
    );
  } else {
    out.push('The server’s Bearer challenge names no `error`.');
  }
  if (challenge.scope) {
    out.push(`It says this request needs \`${shown(challenge.scope)}\`.`);
  }
  if (challenge.error === 'insufficient_scope' && status === 401) {
    out.push(
      'RFC 6750 sends `insufficient_scope` with 403, not 401. A client that retries on 401 would ask for a new token here, which cannot help.'
    );
  }
  if (challenge.error === 'invalid_token' && status === 403) {
    out.push('RFC 6750 sends `invalid_token` with 401, not 403.');
  }
  return out;
}

function scopePoints(need: RequestNeed, input: DenialInput): string[] {
  const granted = input.granted;
  if (!granted) return [];
  const all = parseScopes(granted.value);
  const fhir = all.filter((s): s is FhirScope => s.kind === 'fhir');
  const list = all.length > 0 ? all.map((s) => `\`${shown(s.raw, 120)}\``).join(' ') : 'none';
  const sourceNote =
    granted.source === 'implied'
      ? ' The server stated no scopes, so these are the ones requested; nothing confirms they were granted.'
      : granted.source === 'access-token'
        ? ' (read from the access token, as the token response has no `scope`)'
        : '';

  if (need.kind === 'unknown') {
    return [`${need.reason} Granted: ${list}.${sourceNote}`];
  }

  const { resource, op } = need;
  const verb = OPERATION_NAMES[op];
  const forType = fhir.filter((s) => s.resource === '*' || s.resource === resource);
  const full = forType.filter((s) => s.ops.has(op) && !s.params);
  const constrained = forType.filter((s) => s.ops.has(op) && s.params);
  const otherOps = forType.filter((s) => !s.ops.has(op));

  if (full.length === 0 && constrained.length === 0) {
    const context = suggestedContext(input.launchType, input.patient, fhir);
    const out = [
      `This request is a ${verb} on \`${resource}\`, and no granted scope allows that. It needs a scope such as \`${context}/${resource}.${op}\` (\`${context}/${resource}.${V1_SUFFIX[op]}\` in SMART v1). Granted: ${list}.${sourceNote}`
    ];
    if (otherOps.length > 0) {
      out.push(
        `${otherOps.map((s) => `\`${shown(s.raw, 120)}\``).join(' ')} ${otherOps.length === 1 ? 'names' : 'name'} \`${resource}\`, but not ${verb} (\`${op}\`).`
      );
    }
    if (granted.source === 'implied') {
      out.push(
        'If those were requested and still refused, the server may not allow them for this client.'
      );
    }
    return out;
  }

  const used = full.length > 0 ? full : constrained;
  const covering = used.map((s) => `\`${shown(s.raw, 120)}\``);
  const out = [
    `This request is a ${verb} on \`${resource}\`, which ${covering.join(' and ')} ${covering.length === 1 ? 'allows' : 'allow'}. So the token claims a permission the server refused.${sourceNote}`
  ];
  if (full.length === 0) {
    out.push(
      'Those scopes carry search-parameter constraints, so the server only allows requests that match them.'
    );
  }
  if (used.every((s) => s.context === 'patient')) {
    out.push(
      input.patient
        ? `\`patient/\` scopes reach only the record of the patient in context (\`Patient/${shown(input.patient, 80)}\`) and what links to it.`
        : '`patient/` scopes reach only the patient in context, and this session has none.'
    );
  }
  out.push(
    granted.source === 'token-response'
      ? 'A token response can repeat the requested scopes even when the client’s registration on the server does not allow them. Check that the client is registered for these scopes, and the server’s own access rules for this client or user.'
      : 'Check that the client is registered on the server for these scopes, and the server’s own access rules for this client or user.'
  );
  return out;
}

/** The scope context to suggest: what this kind of session can hold. */
function suggestedContext(
  launchType: LaunchType | null,
  patient: string | null,
  fhir: FhirScope[]
): FhirScope['context'] {
  if (launchType === 'backend-services') return 'system';
  const held = fhir[0]?.context;
  if (held && held !== 'system') return held;
  return patient ? 'patient' : 'user';
}
