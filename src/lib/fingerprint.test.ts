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
import { fingerprint } from './fingerprint';

describe('fingerprint', () => {
  it('is stable and fixed-width', () => {
    expect(fingerprint('refresh-1')).toBe(fingerprint('refresh-1'));
    expect(fingerprint('')).toMatch(/^[0-9a-z]{7}$/);
    expect(fingerprint('a'.repeat(5000))).toMatch(/^[0-9a-z]{7}$/);
  });

  it('tells nearby values apart', () => {
    const values = ['refresh-1', 'refresh-2', 'refresh-10', 'Refresh-1', 'refresh-1 '];
    expect(new Set(values.map(fingerprint)).size).toBe(values.length);
  });

  it('never contains the value', () => {
    expect(fingerprint('secret')).not.toContain('secret');
  });
});
