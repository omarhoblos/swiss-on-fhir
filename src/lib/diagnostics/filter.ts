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

import type { CheckStatus } from './types';

/**
 * Per-group status filtering for the diagnostics page.
 *
 * Kept out of the component so the two decisions that are easy to get wrong
 * -- what a running row does, and what the counts mean -- are unit-testable
 * rather than only observable by clicking through a live run.
 */

/**
 * The statuses a user can filter to. `running` is deliberately absent: it is
 * a transient state, not an outcome, so offering it as a choice would give a
 * menu entry that empties itself the moment the run finishes.
 */
export const FILTERABLE_STATUSES = ['pass', 'warn', 'fail', 'skip', 'manual'] as const;

export type FilterableStatus = (typeof FILTERABLE_STATUSES)[number];

export type StatusFilter = 'all' | FilterableStatus;

/** Matches the wording already used in the Summary card. */
export const STATUS_FILTER_LABELS: Record<FilterableStatus, string> = {
  pass: 'Passed',
  warn: 'Warnings',
  fail: 'Failed',
  skip: 'Skipped',
  manual: 'Manual'
};

/**
 * A running check is always shown, whatever the filter.
 *
 * Its outcome is not known yet, so hiding it would make rows appear and
 * disappear underneath the user mid-run -- and a row that is filtered out
 * before it has even reported is indistinguishable from a check that never
 * ran.
 */
export function matchesFilter(status: CheckStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (status === 'running') return true;
  return status === filter;
}

/**
 * Tallies a group so the menu can say how many rows each choice would leave.
 *
 * Every filterable status is present even at zero, so the options keep a
 * stable order and do not shift around as a run progresses.
 */
export function countByStatus(
  checks: readonly { status: CheckStatus }[]
): Record<FilterableStatus, number> {
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0, manual: 0 };
  for (const check of checks) {
    if (check.status === 'running') continue;
    counts[check.status] += 1;
  }
  return counts;
}

/** Human label for any filter value, `all` included. */
export function filterLabel(filter: StatusFilter): string {
  return filter === 'all' ? 'All statuses' : STATUS_FILTER_LABELS[filter];
}
