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
import { isTabId } from './tab-id';

describe('isTabId', () => {
  it('accepts only the generated shape', () => {
    expect(isTabId('a1b2c3d4')).toBe(true);
    for (const value of ['A1B2C3D4', 'short', 'a1b2c3d4e', '<script>', 7]) {
      expect(isTabId(value), String(value)).toBe(false);
    }
  });
});
