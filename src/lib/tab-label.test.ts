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
import { cleanTabLabel, copiedTabLabel, isTabId, MAX_TAB_LABEL_LENGTH } from './tab-label';

describe('cleanTabLabel', () => {
  it('keeps free text up to 64 characters', () => {
    expect(cleanTabLabel('Admin user, EU staging')).toBe('Admin user, EU staging');
    expect(cleanTabLabel('x'.repeat(100))).toHaveLength(MAX_TAB_LABEL_LENGTH);
  });

  it('strips control characters and collapses whitespace', () => {
    expect(cleanTabLabel(' a\n\tb\u0007 ')).toBe('a b');
  });

  it('returns an empty label for nothing usable', () => {
    for (const value of ['', '   ', null, 3]) expect(cleanTabLabel(value)).toBe('');
  });
});

describe('copiedTabLabel', () => {
  it('marks a copy and keeps the mark within the limit', () => {
    expect(copiedTabLabel('Admin')).toBe('Admin (copy)');
    const long = copiedTabLabel('y'.repeat(MAX_TAB_LABEL_LENGTH));
    expect(long).toHaveLength(MAX_TAB_LABEL_LENGTH);
    expect(long.endsWith(' (copy)')).toBe(true);
  });
});

describe('isTabId', () => {
  it('accepts only the generated shape', () => {
    expect(isTabId('a1b2c3d4')).toBe(true);
    for (const value of ['A1B2C3D4', 'short', 'a1b2c3d4e', '<script>', 7]) {
      expect(isTabId(value), String(value)).toBe(false);
    }
  });
});
