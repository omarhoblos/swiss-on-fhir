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
import { KONAMI_CODE, konamiDetector } from './konami';

function press(keys: readonly string[]): boolean[] {
  const detect = konamiDetector();
  return keys.map((key) => detect(key));
}

describe('konamiDetector', () => {
  it('fires on the key that completes the code, and only then', () => {
    const results = press(KONAMI_CODE);
    expect(results.at(-1)).toBe(true);
    expect(results.slice(0, -1).every((r) => !r)).toBe(true);
  });

  it('takes B and A in either case', () => {
    expect(press([...KONAMI_CODE.slice(0, 8), 'B', 'A']).at(-1)).toBe(true);
  });

  it('still completes after a stray extra up', () => {
    expect(press(['ArrowUp', ...KONAMI_CODE]).at(-1)).toBe(true);
  });

  it('does not fire on a wrong or incomplete sequence', () => {
    expect(press([...KONAMI_CODE.slice(0, 8), 'a', 'b']).some(Boolean)).toBe(false);
    expect(press(KONAMI_CODE.slice(0, 9)).some(Boolean)).toBe(false);
    expect(press(['ArrowUp', 'ArrowDown', ...KONAMI_CODE.slice(2)]).some(Boolean)).toBe(false);
  });

  it('starts over after firing, so the code works again', () => {
    const results = press([...KONAMI_CODE, ...KONAMI_CODE]);
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(press([...KONAMI_CODE, 'a']).filter(Boolean)).toHaveLength(1);
  });
});
