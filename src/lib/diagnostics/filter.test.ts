import { describe, expect, it } from 'vitest';
import {
  countByStatus,
  filterLabel,
  FILTERABLE_STATUSES,
  matchesFilter,
  STATUS_FILTER_LABELS
} from './filter';
import type { CheckStatus } from './types';

describe('matchesFilter', () => {
  it('shows everything under "all"', () => {
    for (const status of [...FILTERABLE_STATUSES, 'running'] as CheckStatus[]) {
      expect(matchesFilter(status, 'all'), status).toBe(true);
    }
  });

  it('shows only the selected status', () => {
    expect(matchesFilter('fail', 'fail')).toBe(true);
    expect(matchesFilter('pass', 'fail')).toBe(false);
    expect(matchesFilter('warn', 'fail')).toBe(false);
    expect(matchesFilter('skip', 'manual')).toBe(false);
    expect(matchesFilter('manual', 'manual')).toBe(true);
  });

  it('never hides a running check', () => {
    // Its outcome is not known yet, so filtering it out would make rows
    // vanish and reappear mid-run, and a row hidden before it reported is
    // indistinguishable from one that never ran.
    for (const status of FILTERABLE_STATUSES) {
      expect(matchesFilter('running', status), status).toBe(true);
    }
  });
});

describe('countByStatus', () => {
  it('tallies each status', () => {
    const counts = countByStatus([
      { status: 'pass' },
      { status: 'pass' },
      { status: 'fail' },
      { status: 'warn' },
      { status: 'skip' },
      { status: 'manual' }
    ]);

    expect(counts).toEqual({ pass: 2, warn: 1, fail: 1, skip: 1, manual: 1 });
  });

  it('reports zero rather than omitting a status, so the menu order is stable', () => {
    expect(countByStatus([])).toEqual({ pass: 0, warn: 0, fail: 0, skip: 0, manual: 0 });
  });

  it('excludes running checks, which have no outcome to count yet', () => {
    const counts = countByStatus([{ status: 'running' }, { status: 'pass' }]);
    expect(counts.pass).toBe(1);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('filterLabel', () => {
  it('labels every filter value, including all', () => {
    expect(filterLabel('all')).toBe('All statuses');
    for (const status of FILTERABLE_STATUSES) {
      expect(filterLabel(status)).toBe(STATUS_FILTER_LABELS[status]);
    }
  });

  it('does not offer running as a choice', () => {
    // It is a transient state, not an outcome; an option for it would empty
    // itself the moment the run finished.
    expect(FILTERABLE_STATUSES).not.toContain('running');
  });
});
