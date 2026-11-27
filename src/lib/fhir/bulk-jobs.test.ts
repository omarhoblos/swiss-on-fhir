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
import {
  MAX_BULK_CALLS,
  MAX_BULK_JOBS,
  bulkJobsKey,
  matchesBulkJob,
  parseBulkJobs,
  recordBulkCall,
  removeBulkJob,
  type BulkCallRecord,
  type BulkJob
} from './bulk-jobs';

const BASE = 'https://fhir.test';
const STATUS = `${BASE}/$export-poll-status?_jobId=1`;

const call = (overrides: Partial<BulkCallRecord> = {}): BulkCallRecord => ({
  kind: 'poll',
  statusUrl: STATUS,
  base: BASE,
  at: 1_000,
  status: 202,
  state: 'in-progress',
  ...overrides
});

describe('recordBulkCall', () => {
  it('starts a job from a kick-off, keeping where it came from', () => {
    const jobs = recordBulkCall([], {
      ...call({ kind: 'kickoff', state: 'started' }),
      kickoffUrl: `${BASE}/$export`
    });
    expect(jobs).toEqual([
      {
        statusUrl: STATUS,
        base: BASE,
        kickoffUrl: `${BASE}/$export`,
        state: 'started',
        calls: [{ kind: 'kickoff', at: 1_000, status: 202 }]
      }
    ]);
  });

  it('adds each later call to the same job, which takes the newest state', () => {
    let jobs = recordBulkCall([], { ...call({ kind: 'kickoff' }), kickoffUrl: `${BASE}/$export` });
    jobs = recordBulkCall(jobs, call({ at: 2_000 }));
    jobs = recordBulkCall(jobs, call({ at: 3_000, status: 200, state: 'complete' }));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.state).toBe('complete');
    expect(jobs[0]?.kickoffUrl).toBe(`${BASE}/$export`);
    expect(jobs[0]?.calls.map((c) => c.at)).toEqual([1_000, 2_000, 3_000]);
  });

  it('keeps a status URL typed in by hand once it is polled', () => {
    const jobs = recordBulkCall([], call({ statusUrl: `  ${STATUS}  ` }));
    expect(jobs[0]?.statusUrl).toBe(STATUS);
    expect(jobs[0]?.kickoffUrl).toBeNull();
  });

  it('puts the job last called first, and drops the oldest past the cap', () => {
    let jobs: BulkJob[] = [];
    for (let i = 0; i < MAX_BULK_JOBS + 2; i += 1) {
      jobs = recordBulkCall(jobs, call({ statusUrl: `${BASE}/status/${i}`, at: i }));
    }
    expect(jobs).toHaveLength(MAX_BULK_JOBS);
    expect(jobs[0]?.statusUrl).toBe(`${BASE}/status/${MAX_BULK_JOBS + 1}`);
    jobs = recordBulkCall(jobs, call({ statusUrl: `${BASE}/status/5`, at: 99 }));
    expect(jobs[0]?.statusUrl).toBe(`${BASE}/status/5`);
    expect(jobs).toHaveLength(MAX_BULK_JOBS);
  });

  it('keeps only the latest calls of a long-running export', () => {
    let jobs: BulkJob[] = [];
    for (let i = 0; i < MAX_BULK_CALLS + 5; i += 1) jobs = recordBulkCall(jobs, call({ at: i }));
    expect(jobs[0]?.calls).toHaveLength(MAX_BULK_CALLS);
    expect(jobs[0]?.calls[0]?.at).toBe(5);
  });

  it('ignores an empty status URL', () => {
    expect(recordBulkCall([], call({ statusUrl: '  ' }))).toEqual([]);
  });
});

describe('removeBulkJob', () => {
  it('forgets one status URL and keeps the rest', () => {
    const jobs = recordBulkCall(recordBulkCall([], call()), call({ statusUrl: `${BASE}/other` }));
    expect(removeBulkJob(jobs, STATUS).map((j) => j.statusUrl)).toEqual([`${BASE}/other`]);
  });
});

describe('matchesBulkJob', () => {
  const [job] = recordBulkCall([], call({ status: 429, state: 'too-many-requests' }));
  it('matches the URL, the state and the last status, ignoring case', () => {
    expect(matchesBulkJob(job!, '')).toBe(true);
    expect(matchesBulkJob(job!, 'JOBID=1')).toBe(true);
    expect(matchesBulkJob(job!, 'too-many')).toBe(true);
    expect(matchesBulkJob(job!, '429')).toBe(true);
    expect(matchesBulkJob(job!, 'complete')).toBe(false);
  });
});

describe('parseBulkJobs', () => {
  it('reads back what was stored', () => {
    const jobs = recordBulkCall([], call());
    expect(parseBulkJobs(JSON.stringify(jobs))).toEqual(jobs);
  });

  it('is empty for nothing stored, or something that is not a list of jobs', () => {
    expect(parseBulkJobs(null)).toEqual([]);
    expect(parseBulkJobs('not json')).toEqual([]);
    expect(parseBulkJobs('{"statusUrl":"x"}')).toEqual([]);
  });

  it('drops malformed jobs and calls, and a repeated status URL', () => {
    const [good] = recordBulkCall([], call());
    const stored = [
      good,
      { ...good, statusUrl: `${BASE}/bad-state`, state: 'exploded' },
      { ...good, statusUrl: '' },
      { ...good, statusUrl: `${BASE}/no-calls`, calls: 'none' },
      {
        ...good,
        statusUrl: `${BASE}/some-calls`,
        calls: [
          { kind: 'poll', at: 1, status: null },
          { kind: 'teleport', at: 2, status: 200 }
        ]
      },
      { ...good, calls: [] }
    ];
    const jobs = parseBulkJobs(JSON.stringify(stored));
    expect(jobs.map((j) => j.statusUrl)).toEqual([STATUS, `${BASE}/some-calls`]);
    expect(jobs[1]?.calls).toEqual([{ kind: 'poll', at: 1, status: null }]);
  });
});

describe('bulkJobsKey', () => {
  it('keeps one list per environment', () => {
    expect(bulkJobsKey('default')).toBe('swiss.bulk-jobs.v1.default');
    expect(bulkJobsKey('env-a')).not.toBe(bulkJobsKey('env-b'));
  });
});
