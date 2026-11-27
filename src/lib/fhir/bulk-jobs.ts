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

import type { PollState } from './bulk-export';

/**
 * The bulk export status URLs a browser tab has seen, so a reload does not
 * lose an export still running on the server. Each one keeps the calls Swiss
 * made to it: when, which, and what came back. The requests themselves are in
 * the exchange log.
 *
 * Kept in sessionStorage, one list per environment: a reload keeps it, closing
 * the tab drops it. What is read back is checked, as any storage is.
 */

export type BulkCallKind = 'kickoff' | 'poll' | 'cancel';

/** Where a job stood after its last call. */
export type BulkJobState = PollState | 'started' | 'cancelled' | 'refused' | 'no-answer';

export interface BulkCall {
  kind: BulkCallKind;
  at: number;
  /** HTTP status, or null when no response came back. */
  status: number | null;
}

export interface BulkJob {
  statusUrl: string;
  /** The FHIR base the export was started or polled on: the token's origin. */
  base: string;
  /** The kick-off request, when Swiss started the export. */
  kickoffUrl: string | null;
  state: BulkJobState;
  /** Oldest first. */
  calls: BulkCall[];
}

export const MAX_BULK_JOBS = 20;
export const MAX_BULK_CALLS = 50;
const MAX_URL_LENGTH = 8_192;

const KINDS: readonly BulkCallKind[] = ['kickoff', 'poll', 'cancel'];
const STATES: readonly BulkJobState[] = [
  'in-progress',
  'complete',
  'failed',
  'too-many-requests',
  'unexpected',
  'started',
  'cancelled',
  'refused',
  'no-answer'
];

export const BULK_JOB_STATE_LABEL: Record<BulkJobState, string> = {
  'in-progress': 'In progress',
  complete: 'Complete',
  failed: 'Failed or gone',
  'too-many-requests': 'Polling too often',
  unexpected: 'Unexpected answer',
  started: 'Started',
  cancelled: 'Cancelled',
  refused: 'Refused',
  'no-answer': 'No answer'
};

export function bulkJobsKey(envId: string): string {
  return `swiss.bulk-jobs.v1.${envId}`;
}

export interface BulkCallRecord extends BulkCall {
  statusUrl: string;
  base: string;
  kickoffUrl?: string;
  state: BulkJobState;
}

/**
 * Adds a call to the job for its status URL, creating the job if it is new,
 * and moves that job to the front. The oldest jobs and calls past the caps go.
 */
export function recordBulkCall(jobs: readonly BulkJob[], record: BulkCallRecord): BulkJob[] {
  const statusUrl = record.statusUrl.trim();
  if (!statusUrl || statusUrl.length > MAX_URL_LENGTH) return [...jobs];
  const existing = jobs.find((job) => job.statusUrl === statusUrl);
  const call: BulkCall = { kind: record.kind, at: record.at, status: record.status };
  const job: BulkJob = {
    statusUrl,
    base: record.base,
    kickoffUrl: record.kickoffUrl ?? existing?.kickoffUrl ?? null,
    state: record.state,
    calls: [...(existing?.calls ?? []), call].slice(-MAX_BULK_CALLS)
  };
  return [job, ...jobs.filter((j) => j !== existing)].slice(0, MAX_BULK_JOBS);
}

export function removeBulkJob(jobs: readonly BulkJob[], statusUrl: string): BulkJob[] {
  return jobs.filter((job) => job.statusUrl !== statusUrl);
}

/** When the job was last called, for sorting and display. */
export function lastCallAt(job: BulkJob): number {
  return job.calls.at(-1)?.at ?? 0;
}

/** Whether a job matches a search: its URLs, its state or its last status. */
export function matchesBulkJob(job: BulkJob, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const last = job.calls.at(-1)?.status;
  return [job.statusUrl, job.kickoffUrl ?? '', job.state, last === undefined ? '' : String(last)]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function isUrlString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_URL_LENGTH;
}

function readCall(raw: unknown): BulkCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (!KINDS.includes(c.kind as BulkCallKind)) return null;
  if (typeof c.at !== 'number' || !Number.isFinite(c.at)) return null;
  const status = c.status;
  if (status !== null && (typeof status !== 'number' || !Number.isInteger(status))) return null;
  return { kind: c.kind as BulkCallKind, at: c.at, status };
}

function readJob(raw: unknown): BulkJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  if (!isUrlString(j.statusUrl) || typeof j.base !== 'string' || j.base.length > MAX_URL_LENGTH) {
    return null;
  }
  if (j.kickoffUrl !== null && !isUrlString(j.kickoffUrl)) return null;
  if (!STATES.includes(j.state as BulkJobState)) return null;
  if (!Array.isArray(j.calls)) return null;
  const calls = j.calls
    .slice(-MAX_BULK_CALLS)
    .map(readCall)
    .filter((c) => c !== null);
  return {
    statusUrl: j.statusUrl,
    base: j.base,
    kickoffUrl: j.kickoffUrl,
    state: j.state as BulkJobState,
    calls
  };
}

/** What sessionStorage held, keeping only well-formed jobs, one per status URL. */
export function parseBulkJobs(raw: string | null): BulkJob[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const jobs: BulkJob[] = [];
  for (const entry of parsed) {
    const job = readJob(entry);
    if (!job || seen.has(job.statusUrl)) continue;
    seen.add(job.statusUrl);
    jobs.push(job);
    if (jobs.length === MAX_BULK_JOBS) break;
  }
  return jobs;
}
