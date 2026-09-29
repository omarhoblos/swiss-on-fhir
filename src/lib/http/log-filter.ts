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

import type { HttpExchange } from './exchange';

/**
 * Searching and status filtering for the exchange log drawer.
 *
 * Kept out of the component, like the diagnostics filter, so what a status
 * is and what a search matches are unit-testable rather than only observable
 * by clicking through a live log. Filtering only narrows the view: downloads
 * always contain every entry.
 */

/**
 * The status an entry is filed under: its HTTP status code, or `failed` /
 * `blocked` when no response came back, since those are exactly the entries
 * someone is usually looking for.
 */
export function statusLabel(entry: Pick<HttpExchange, 'response' | 'outcome'>): string {
  if (entry.outcome === 'aborted') return 'cancelled';
  if (entry.response) return String(entry.response.status);
  return entry.outcome === 'blocked-precondition' ? 'blocked' : 'failed';
}

export type StatusTone = 'success' | 'info' | 'warning' | 'error';

export function statusTone(label: string): StatusTone {
  // Stopped on this side: nothing went wrong with the server.
  if (label === 'cancelled') return 'info';
  const status = Number(label);
  if (!Number.isInteger(status)) return 'error';
  if (status < 300) return 'success';
  if (status < 400) return 'info';
  if (status < 500) return 'warning';
  return 'error';
}

/**
 * Every status present in the log, with how many entries carry it: codes in
 * numeric order, then `blocked` and `failed`. Counted over the whole log, not
 * the search, so a chip does not vanish while you type.
 */
export function statusCounts(
  entries: readonly Pick<HttpExchange, 'response' | 'outcome'>[]
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const label = statusLabel(entry);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const rank = (label: string) => {
    const status = Number(label);
    if (Number.isInteger(status)) return status;
    return ({ blocked: 1000, failed: 1001 } as Record<string, number>)[label] ?? 1002;
  };
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => rank(a.label) - rank(b.label));
}

/**
 * Case-insensitive match on what the collapsed row shows or describes: the
 * method, URL, status, status text and the label saying which part of Swiss
 * made the request. Bodies and headers are not searched: they are long, and
 * they are where the (possibly unredacted) credentials live.
 */
export function matchesQuery(entry: HttpExchange, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    entry.request.method,
    entry.request.url,
    entry.label,
    statusLabel(entry),
    entry.response?.statusText ?? ''
  ].some((text) => text.toLowerCase().includes(needle));
}

export function filterEntries<T extends HttpExchange>(
  entries: readonly T[],
  query: string,
  hidden: ReadonlySet<string>
): T[] {
  return entries.filter((entry) => !hidden.has(statusLabel(entry)) && matchesQuery(entry, query));
}
