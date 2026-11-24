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

import { describe, expect, it } from 'vitest';
import type { HttpExchange } from '#lib/http/exchange.ts';
import {
  EMPTY_KICKOFF,
  MAX_POLL_MS,
  MIN_POLL_MS,
  DEFAULT_POLL_MS,
  bulkHeaders,
  checkFile,
  kickoffQuery,
  parseRetryAfter,
  pollDelay,
  previewNdjson,
  readKickoff,
  readManifest,
  readPoll,
  statusUrlInBody
} from './bulk-export';

const KICKOFF_URL = 'https://fhir.test/r4/$export';

function exchange(
  status: number | undefined,
  headers: Record<string, string> = {},
  url = KICKOFF_URL,
  body?: string
): HttpExchange {
  return {
    id: 'x1',
    label: 'GET /$export',
    startedAt: 0,
    durationMs: 1,
    request: { method: 'GET', url, headers: {} },
    response: status === undefined ? undefined : { status, statusText: '', headers, body },
    outcome: 'ok',
    redactions: []
  } as HttpExchange;
}

describe('kickoffQuery', () => {
  it('builds each level', () => {
    expect(kickoffQuery(EMPTY_KICKOFF)).toBe('$export');
    expect(kickoffQuery({ ...EMPTY_KICKOFF, level: 'patient' })).toBe('Patient/$export');
    expect(kickoffQuery({ ...EMPTY_KICKOFF, level: 'group', groupId: ' g 1 ' })).toBe(
      'Group/g%201/$export'
    );
  });

  it('needs a group id for a Group export', () => {
    expect(kickoffQuery({ ...EMPTY_KICKOFF, level: 'group', groupId: '  ' })).toBeNull();
  });

  it('adds only the parameters given, keeping commas readable', () => {
    expect(
      kickoffQuery({
        ...EMPTY_KICKOFF,
        types: 'Patient, Observation',
        since: '2026-01-01T00:00:00Z',
        typeFilter: 'Observation?status=final'
      })
    ).toBe(
      '$export?_since=2026-01-01T00%3A00%3A00Z&_type=Patient,Observation&_typeFilter=Observation%3Fstatus%3Dfinal'
    );
  });
});

describe('bulkHeaders', () => {
  it('replaces the user’s own Accept and Prefer under any capitalisation', () => {
    expect(
      bulkHeaders(
        { accept: 'text/plain', PREFER: 'return=minimal', 'X-Api-Key': 'k' },
        { Accept: 'application/fhir+json', Prefer: 'respond-async' }
      )
    ).toEqual({ 'X-Api-Key': 'k', Accept: 'application/fhir+json', Prefer: 'respond-async' });
  });
});

describe('readKickoff', () => {
  it('takes the status URL from Content-Location', () => {
    const result = readKickoff(
      exchange(202, { 'content-location': 'https://fhir.test/bulk/status/1' })
    );
    expect(result).toEqual({ statusUrl: 'https://fhir.test/bulk/status/1', findings: [] });
  });

  it('resolves a relative Content-Location, and says so', () => {
    const result = readKickoff(exchange(202, { 'content-location': '/bulk/status/1' }));
    expect(result.statusUrl).toBe('https://fhir.test/bulk/status/1');
    expect(result.findings[0]?.severity).toBe('warning');
  });

  it('refuses a Content-Location that is not http(s)', () => {
    const result = readKickoff(exchange(202, { 'content-location': 'javascript:alert(1)' }));
    expect(result.statusUrl).toBeNull();
    expect(result.findings[0]?.severity).toBe('error');
  });

  it('falls back to Location, with a warning', () => {
    const result = readKickoff(exchange(202, { location: 'https://fhir.test/bulk/status/1' }));
    expect(result.statusUrl).toBe('https://fhir.test/bulk/status/1');
    expect(result.findings[0]?.text).toMatch(/came in `Location`/);
  });

  it('explains a 202 whose Content-Location cannot be read, and where to find it', () => {
    const result = readKickoff(exchange(202));
    expect(result.statusUrl).toBeNull();
    expect(result.findings.map((f) => f.severity)).toEqual(['error', 'info']);
    expect(result.findings[0]?.text).toContain(
      '`Access-Control-Expose-Headers: Content-Location, X-Progress, Retry-After`'
    );
    expect(result.findings[1]?.text).toMatch(/developer tools.*Network tab/);
  });

  it('takes the status URL from the body when Content-Location cannot be read', () => {
    const body = JSON.stringify({
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: 'information',
          code: 'informational',
          diagnostics: `Job accepted. Poll ${'https://fhir.test/r4/$export-poll-status?_jobId=42'}.`
        }
      ]
    });
    const result = readKickoff(exchange(202, {}, KICKOFF_URL, body));
    expect(result.statusUrl).toBe('https://fhir.test/r4/$export-poll-status?_jobId=42');
    expect(result.findings.map((f) => f.severity)).toEqual(['warning', 'info']);
    expect(result.findings[0]?.text).toMatch(/taken from the response body/);
  });

  it('notes a kick-off that did not answer 202', () => {
    const result = readKickoff(exchange(200));
    expect(result.findings[0]?.text).toMatch(/respond-async/);
  });

  it('reports a refused kick-off', () => {
    const result = readKickoff(exchange(403, { 'content-location': 'https://x.test/' }));
    expect(result.statusUrl).toBeNull();
    expect(result.findings[0]?.severity).toBe('error');
  });

  it('says nothing when no response came back', () => {
    expect(readKickoff(exchange(undefined))).toEqual({ statusUrl: null, findings: [] });
  });
});

describe('statusUrlInBody', () => {
  it('finds a status URL, JSON-escaped or followed by punctuation', () => {
    expect(
      statusUrlInBody('{"url":"https:\\/\\/fhir.test\\/bulk\\/status\\/7"}', KICKOFF_URL)
    ).toBe('https://fhir.test/bulk/status/7');
    expect(statusUrlInBody('Poll https://fhir.test/jobs/7.', KICKOFF_URL)).toBe(
      'https://fhir.test/jobs/7'
    );
  });

  it('ignores the kick-off URL, other origins and links that are not about a job', () => {
    expect(statusUrlInBody(`Started ${KICKOFF_URL}`, KICKOFF_URL)).toBeNull();
    expect(statusUrlInBody('https://other.test/bulk/status/7', KICKOFF_URL)).toBeNull();
    expect(statusUrlInBody('See https://fhir.test/r4/Patient/1', KICKOFF_URL)).toBeNull();
    expect(statusUrlInBody(undefined, KICKOFF_URL)).toBeNull();
  });
});

describe('parseRetryAfter and pollDelay', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    const now = Date.parse('2026-11-17T10:00:00Z');
    expect(parseRetryAfter('Tue, 17 Nov 2026 10:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Tue, 17 Nov 2026 09:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('keeps the delay within bounds', () => {
    expect(pollDelay(null)).toBe(DEFAULT_POLL_MS);
    expect(pollDelay(0)).toBe(MIN_POLL_MS);
    expect(pollDelay(30_000)).toBe(30_000);
    expect(pollDelay(24 * 3600_000)).toBe(MAX_POLL_MS);
  });
});

describe('readPoll', () => {
  const STATUS = 'https://fhir.test/bulk/status/1';

  it('reads an export in progress', () => {
    const result = readPoll(
      exchange(202, { 'x-progress': '50% done', 'retry-after': '5' }, STATUS),
      undefined
    );
    expect(result).toMatchObject({
      state: 'in-progress',
      progress: '50% done',
      retryAfterMs: 5000
    });
  });

  it('reads a completed export', () => {
    const result = readPoll(exchange(200, {}, STATUS), {
      transactionTime: '2026-11-17T10:00:00Z',
      request: KICKOFF_URL,
      requiresAccessToken: true,
      output: [{ type: 'Patient', url: 'https://files.test/1.ndjson', count: 2 }],
      error: []
    });
    expect(result?.state).toBe('complete');
    expect(result?.findings).toEqual([]);
    expect(result?.manifest?.output).toEqual([
      { type: 'Patient', url: 'https://files.test/1.ndjson', count: 2 }
    ]);
  });

  it('reports too many requests and failures', () => {
    expect(readPoll(exchange(429, { 'retry-after': '60' }, STATUS), undefined)).toMatchObject({
      state: 'too-many-requests',
      retryAfterMs: 60_000
    });
    expect(readPoll(exchange(500, {}, STATUS), undefined)?.state).toBe('failed');
    expect(readPoll(exchange(204, {}, STATUS), undefined)?.state).toBe('unexpected');
    expect(readPoll(exchange(undefined), undefined)).toBeNull();
  });
});

describe('readManifest', () => {
  it('names each missing required field', () => {
    const { manifest, findings } = readManifest({ output: 'nope' });
    expect(manifest?.output).toEqual([]);
    const texts = findings.map((f) => f.text).join('\n');
    expect(texts).toMatch(/transactionTime/);
    expect(texts).toMatch(/`request`/);
    expect(texts).toMatch(/requiresAccessToken/);
    expect(texts).toMatch(/`output` is not an array/);
    expect(texts).toMatch(/no `error` array/);
  });

  it('drops a file URL that is not http(s)', () => {
    const { manifest, findings } = readManifest({
      transactionTime: 't',
      request: 'r',
      requiresAccessToken: false,
      output: [{ type: 'Patient', url: 'data:text/plain,hi' }, { url: 'https://f.test/2' }],
      error: []
    });
    expect(manifest?.output).toEqual([
      { type: 'Patient', url: null, count: null },
      { type: null, url: 'https://f.test/2', count: null }
    ]);
    expect(findings.map((f) => f.text)).toEqual([
      '`output[0].url` is not an absolute http(s) URL: `data:text/plain,hi`.',
      '`output[1]` has no `type`.'
    ]);
  });

  it('refuses a body that is not an object', () => {
    expect(readManifest([]).manifest).toBeNull();
    expect(readManifest(undefined).findings[0]?.severity).toBe('error');
  });
});

describe('previewNdjson and checkFile', () => {
  const text = [
    '{"resourceType":"Patient","id":"a"}',
    '',
    '{"resourceType":"Patient","id":"b"}',
    '{"resourceType":"Observation","id":"c"}',
    'not json'
  ].join('\n');

  it('counts resources by type and finds lines that do not parse', () => {
    const preview = previewNdjson(text, 2);
    expect(preview).toEqual({
      lines: 4,
      head: ['{"resourceType":"Patient","id":"a"}', '{"resourceType":"Patient","id":"b"}'],
      types: [
        ['Patient', 2],
        ['Observation', 1]
      ],
      invalid: [5],
      invalidCount: 1
    });
  });

  it('compares the file with its manifest entry', () => {
    const findings = checkFile({ type: 'Patient', url: 'u', count: 2 }, previewNdjson(text));
    expect(findings.map((f) => f.text)).toEqual([
      '1 line is not a JSON object (line 5).',
      'The manifest says 2 resources; the file has 4.',
      'Listed as `Patient`, but the file also holds 1 `Observation`.'
    ]);
    expect(
      checkFile(
        { type: 'Patient', url: 'u', count: 1 },
        previewNdjson('{"resourceType":"Patient"}')
      )
    ).toEqual([]);
  });

  it('notes a file not served as NDJSON', () => {
    const preview = previewNdjson('{"resourceType":"Patient"}');
    const file = { type: 'Patient', url: 'u', count: 1 };
    expect(checkFile(file, preview, 'application/fhir+ndjson')).toEqual([]);
    expect(checkFile(file, preview, 'text/plain')[0]?.severity).toBe('info');
  });
});
