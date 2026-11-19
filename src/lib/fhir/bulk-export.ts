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
import { httpUrl } from '#lib/url.ts';

/**
 * Bulk Data export ($export), kept pure for the FHIR console's Bulk export
 * card.
 *
 * The asynchronous pattern hides its one important value in a response
 * header: a kick-off answers 202 with the job's status URL in
 * Content-Location, which a browser can read only when the server lists it
 * in Access-Control-Expose-Headers. Each step here turns what came back into
 * findings, the way the rest of Swiss does: a missing header or a malformed
 * manifest is reported beside the result, never a reason to stop.
 */

export type ExportLevel = 'system' | 'patient' | 'group';

export interface KickoffParams {
  level: ExportLevel;
  /** For a Group export. */
  groupId: string;
  /** `_type`: comma-separated resource types. */
  types: string;
  /** `_since`: an instant. */
  since: string;
  /** `_typeFilter`: comma-separated FHIR searches. */
  typeFilter: string;
  /** `_outputFormat`; the server's default (NDJSON) when empty. */
  outputFormat: string;
}

export const EMPTY_KICKOFF: KickoffParams = {
  level: 'system',
  groupId: '',
  types: '',
  since: '',
  typeFilter: '',
  outputFormat: ''
};

/** What a kick-off request carries, as the Bulk Data IG requires. */
export const KICKOFF_HEADERS = {
  Accept: 'application/fhir+json',
  Prefer: 'respond-async'
} as const;

/** The status endpoint answers JSON, not a FHIR resource. */
export const STATUS_ACCEPT = 'application/json';
export const NDJSON_ACCEPT = 'application/fhir+ndjson';

export type Severity = 'error' | 'warning' | 'info';
export interface Finding {
  severity: Severity;
  /** Inline Markdown: backticks for header names and values. */
  text: string;
}

/** Encodes a parameter value but keeps the commas that separate its items readable. */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/%2C/gi, ',');
}

/**
 * The kick-off query, relative to the FHIR base, or null when it cannot be
 * built yet (a Group export without a group id).
 */
export function kickoffQuery(params: KickoffParams): string | null {
  let path: string;
  if (params.level === 'system') path = '$export';
  else if (params.level === 'patient') path = 'Patient/$export';
  else {
    const id = params.groupId.trim();
    if (!id) return null;
    path = `Group/${encodeURIComponent(id)}/$export`;
  }
  const query = (
    [
      ['_outputFormat', params.outputFormat],
      ['_since', params.since],
      ['_type', params.types.replace(/\s+/g, '')],
      ['_typeFilter', params.typeFilter.trim()]
    ] as const
  )
    .map(([name, value]) => [name, value.trim()] as const)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}=${encodeValue(value)}`);
  return query.length > 0 ? `${path}?${query.join('&')}` : path;
}

/**
 * Headers for a bulk request: the user's own, without the ones the step sets.
 * Accept and Prefer are what make a request a kick-off, so the user's own
 * would change what is being tested.
 */
export function bulkHeaders(
  user: Record<string, string>,
  set: Record<string, string>
): Record<string, string> {
  const replaced = new Set(Object.keys(set).map((name) => name.toLowerCase()));
  return Object.fromEntries([
    ...Object.entries(user).filter(([name]) => !replaced.has(name.toLowerCase())),
    ...Object.entries(set)
  ]);
}

function header(exchange: HttpExchange, name: string): string | null {
  const value = exchange.response?.headers?.[name];
  return value === undefined || value.trim() === '' ? null : value.trim();
}

/** Resolves a header URL against the request, keeping only http(s). */
function resolveHeaderUrl(value: string, requestUrl: string): string | null {
  try {
    return httpUrl(new URL(value, requestUrl).toString());
  } catch {
    return null;
  }
}

function isAbsolute(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export interface KickoffResult {
  /** Where to poll, when the response gave one. */
  statusUrl: string | null;
  findings: Finding[];
}

const EXPOSE_HINT =
  'A browser can read it only when the server lists `Content-Location` in `Access-Control-Expose-Headers`. Paste the status URL below to poll it anyway.';

/** What a kick-off's response says, and where its status is. */
export function readKickoff(exchange: HttpExchange): KickoffResult {
  const status = exchange.response?.status;
  if (status === undefined) return { statusUrl: null, findings: [] };
  const findings: Finding[] = [];

  if (status >= 400) {
    findings.push({
      severity: 'error',
      text: `The server refused the export with ${status}. A conforming server says why in an \`OperationOutcome\`.`
    });
    return { statusUrl: null, findings };
  }
  if (status !== 202) {
    findings.push({
      severity: 'warning',
      text: `Expected \`202 Accepted\` from a kick-off; got ${status}. The server may have ignored \`Prefer: respond-async\`.`
    });
  }

  const requestUrl = exchange.request.url;
  const location = header(exchange, 'content-location');
  if (location) {
    const statusUrl = resolveHeaderUrl(location, requestUrl);
    if (!statusUrl) {
      findings.push({
        severity: 'error',
        text: `\`Content-Location\` is not an http(s) URL: \`${location}\`.`
      });
    } else if (!isAbsolute(location)) {
      findings.push({
        severity: 'warning',
        text: `\`Content-Location\` should be an absolute URL; \`${location}\` was resolved against the kick-off URL.`
      });
    }
    return { statusUrl, findings };
  }

  // Some servers put it in Location instead. Used, and said.
  const misplaced = header(exchange, 'location');
  const fallback = misplaced ? resolveHeaderUrl(misplaced, requestUrl) : null;
  if (fallback) {
    findings.push({
      severity: 'warning',
      text: 'The status URL came in `Location`, not `Content-Location` as the Bulk Data IG requires. Polling it anyway.'
    });
    return { statusUrl: fallback, findings };
  }

  if (status === 202) {
    findings.push({
      severity: 'error',
      text: `The server accepted the export but its \`Content-Location\` could not be read: it was not sent, or not exposed. ${EXPOSE_HINT}`
    });
  }
  return { statusUrl: null, findings };
}

/**
 * Retry-After, as milliseconds from `now`: a number of seconds or an HTTP
 * date. Null when absent or unreadable.
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

export const DEFAULT_POLL_MS = 10_000;
export const MIN_POLL_MS = 2_000;
export const MAX_POLL_MS = 10 * 60_000;

/** When to poll next: what the server asked for, within bounds. */
export function pollDelay(retryAfterMs: number | null): number {
  if (retryAfterMs === null) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, retryAfterMs));
}

export interface ManifestFile {
  type: string | null;
  url: string | null;
  count: number | null;
}

export interface Manifest {
  transactionTime: string | null;
  request: string | null;
  requiresAccessToken: boolean | null;
  output: ManifestFile[];
  error: ManifestFile[];
  deleted: ManifestFile[];
}

export type PollState = 'in-progress' | 'complete' | 'failed' | 'too-many-requests' | 'unexpected';

export interface PollResult {
  state: PollState;
  /** X-Progress, as the server worded it. */
  progress: string | null;
  retryAfterMs: number | null;
  manifest: Manifest | null;
  findings: Finding[];
}

/** What a status request's response says. Null when no response came back. */
export function readPoll(
  exchange: HttpExchange,
  json: unknown,
  now = Date.now()
): PollResult | null {
  const status = exchange.response?.status;
  if (status === undefined) return null;
  const progress = header(exchange, 'x-progress');
  const retryAfterMs = parseRetryAfter(header(exchange, 'retry-after'), now);
  const base = { progress, retryAfterMs, manifest: null, findings: [] as Finding[] };

  if (status === 202) return { ...base, state: 'in-progress' };
  if (status === 429) {
    return {
      ...base,
      state: 'too-many-requests',
      findings: [
        {
          severity: 'warning',
          text: `\`429 Too Many Requests\`: the server wants slower polling${retryAfterMs === null ? '' : `, in ${Math.round(retryAfterMs / 1000)}s`}.`
        }
      ]
    };
  }
  if (status >= 400) {
    return {
      ...base,
      state: 'failed',
      findings: [
        {
          severity: 'error',
          text: `The export failed or is gone: the status URL answered ${status}.`
        }
      ]
    };
  }
  if (status !== 200) {
    return {
      ...base,
      state: 'unexpected',
      findings: [
        {
          severity: 'warning',
          text: `A status URL answers \`202\` while the export runs and \`200\` when it is done; got ${status}.`
        }
      ]
    };
  }

  const { manifest, findings } = readManifest(json);
  return { ...base, state: 'complete', manifest, findings };
}

function readFiles(
  value: unknown,
  field: string,
  required: boolean,
  findings: Finding[]
): ManifestFile[] {
  if (value === undefined) {
    if (required) {
      findings.push({ severity: 'error', text: `The manifest has no \`${field}\` array.` });
    }
    return [];
  }
  if (!Array.isArray(value)) {
    findings.push({ severity: 'error', text: `The manifest's \`${field}\` is not an array.` });
    return [];
  }
  return value.map((item: unknown, i) => {
    const entry = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const type = typeof entry.type === 'string' ? entry.type : null;
    const raw = typeof entry.url === 'string' ? entry.url : null;
    const url = httpUrl(raw);
    const count = typeof entry.count === 'number' ? entry.count : null;
    if (!type) {
      findings.push({ severity: 'warning', text: `\`${field}[${i}]\` has no \`type\`.` });
    }
    if (!raw) {
      findings.push({ severity: 'error', text: `\`${field}[${i}]\` has no \`url\`.` });
    } else if (!url) {
      findings.push({
        severity: 'error',
        text: `\`${field}[${i}].url\` is not an absolute http(s) URL: \`${raw}\`.`
      });
    }
    return { type, url, count };
  });
}

/** The completion manifest, with what is missing or malformed in it. */
export function readManifest(json: unknown): { manifest: Manifest | null; findings: Finding[] } {
  const findings: Finding[] = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    findings.push({
      severity: 'error',
      text: 'The export is complete, but its manifest is not a JSON object.'
    });
    return { manifest: null, findings };
  }
  const body = json as Record<string, unknown>;
  const transactionTime = typeof body.transactionTime === 'string' ? body.transactionTime : null;
  if (!transactionTime) {
    findings.push({ severity: 'error', text: 'The manifest has no `transactionTime`.' });
  }
  const request = typeof body.request === 'string' ? body.request : null;
  if (!request) findings.push({ severity: 'error', text: 'The manifest has no `request`.' });
  const requiresAccessToken =
    typeof body.requiresAccessToken === 'boolean' ? body.requiresAccessToken : null;
  if (requiresAccessToken === null) {
    findings.push({
      severity: 'error',
      text: 'The manifest has no boolean `requiresAccessToken`, so the token is sent to the files only on the FHIR server.'
    });
  }
  const manifest: Manifest = {
    transactionTime,
    request,
    requiresAccessToken,
    output: readFiles(body.output, 'output', true, findings),
    error: readFiles(body.error, 'error', true, findings),
    deleted: readFiles(body.deleted, 'deleted', false, findings)
  };
  return { manifest, findings };
}

export interface NdjsonPreview {
  /** Non-empty lines. */
  lines: number;
  /** The first few lines, as they came. */
  head: string[];
  /** Resources per resourceType, in order of first appearance. */
  types: [string, number][];
  /** 1-based numbers of lines that are not a JSON object, the first few. */
  invalid: number[];
  invalidCount: number;
}

/** Reads an NDJSON file: how many resources of each type, and which lines do not parse. */
export function previewNdjson(text: string, headLines = 3): NdjsonPreview {
  const types = new Map<string, number>();
  const invalid: number[] = [];
  let invalidCount = 0;
  const head: string[] = [];
  let lines = 0;
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    lines += 1;
    if (head.length < headLines) head.push(line);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      invalidCount += 1;
      if (invalid.length < 5) invalid.push(i + 1);
      return;
    }
    const type = (parsed as { resourceType?: unknown }).resourceType;
    const key = typeof type === 'string' ? type : '(no resourceType)';
    types.set(key, (types.get(key) ?? 0) + 1);
  });
  return { lines, head, types: [...types], invalid, invalidCount };
}

/** Findings for a downloaded file against its manifest entry. */
export function checkFile(
  file: ManifestFile,
  preview: NdjsonPreview,
  contentType: string | null = null
): Finding[] {
  const findings: Finding[] = [];
  if (contentType !== null && !/ndjson/i.test(contentType)) {
    findings.push({
      severity: 'info',
      text: `Served as \`${contentType}\`; bulk files are usually \`application/fhir+ndjson\`.`
    });
  }
  if (preview.invalidCount > 0) {
    findings.push({
      severity: 'error',
      text: `${preview.invalidCount} ${preview.invalidCount === 1 ? 'line is' : 'lines are'} not a JSON object (line ${preview.invalid.join(', ')}).`
    });
  }
  if (file.count !== null && file.count !== preview.lines) {
    findings.push({
      severity: 'warning',
      text: `The manifest says ${file.count} ${file.count === 1 ? 'resource' : 'resources'}; the file has ${preview.lines}.`
    });
  }
  const others = preview.types.filter(([type]) => type !== file.type);
  if (file.type && others.length > 0) {
    findings.push({
      severity: 'warning',
      text: `Listed as \`${file.type}\`, but the file also holds ${others.map(([t, n]) => `${n} \`${t}\``).join(', ')}.`
    });
  }
  return findings;
}
