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
 * Small time helpers, replacing dayjs.
 *
 * dayjs was pulled in for exactly two things: dayjs.unix(exp) and
 * .diff(now, 'minute'). It also required an allowedCommonJsDependencies
 * entry in angular.json, and the old code read `expirationDate['$d']` --
 * a dayjs private field, which is the kind of thing that breaks on a minor
 * version bump.
 */

/** Epoch SECONDS (as JWT `exp` uses) to a Date. */
export function fromEpochSeconds(seconds: number): Date {
  return new Date(seconds * 1000);
}

export function formatAbsolute(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'long'
  }).format(date);
}

/**
 * A human countdown. Negative values read as "expired N ago" rather than a
 * misleading negative duration.
 */
export function formatCountdown(seconds: number | null): string {
  if (seconds === null) return 'unknown';

  const expired = seconds < 0;
  const total = Math.abs(Math.floor(seconds));

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  let text: string;
  if (days > 0) text = `${days}d ${hours}h`;
  else if (hours > 0) text = `${hours}h ${minutes}m`;
  else if (minutes > 0) text = `${minutes}m ${secs}s`;
  else text = `${secs}s`;

  return expired ? `expired ${text} ago` : text;
}

/** Seconds of clock disagreement worth surfacing as skew. */
export const CLOCK_SKEW_THRESHOLD_SECONDS = 30;
