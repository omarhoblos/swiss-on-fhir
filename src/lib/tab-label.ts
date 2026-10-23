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

import { sanitizeName } from '#lib/environments/types.ts';

/** Tab ids: eight lowercase letters and digits. */
export const TAB_ID_PATTERN = /^[a-z0-9]{8}$/;

export function isTabId(value: unknown): value is string {
  return typeof value === 'string' && TAB_ID_PATTERN.test(value);
}

export const MAX_TAB_LABEL_LENGTH = 64;

/**
 * Cleans a tab label the way environment names are cleaned: control
 * characters become spaces, whitespace collapses, and at most 64 characters
 * are kept. Returns '' for nothing usable.
 */
export function cleanTabLabel(raw: unknown): string {
  return sanitizeName(raw, MAX_TAB_LABEL_LENGTH) ?? '';
}

/** A duplicated tab's label: the original's, marked, still within 64 characters. */
export function copiedTabLabel(label: string): string {
  const suffix = ' (copy)';
  const room = MAX_TAB_LABEL_LENGTH - suffix.length;
  return `${[...label].slice(0, room).join('').trimEnd()}${suffix}`;
}
