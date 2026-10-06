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
 * The Konami Code: up up down down left right left right B A. Matched on
 * `KeyboardEvent.key`, letters in either case, so Caps Lock or Shift does
 * not spoil it.
 */
export const KONAMI_CODE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a'
] as const;

/**
 * Returns a function to call with each key pressed; it answers true on the
 * key that completes the code. It compares the last ten keys rather than
 * counting progress, so a stray extra key, such as a third up, still lets
 * the code complete from where it really starts.
 */
export function konamiDetector(): (key: string) => boolean {
  const recent: string[] = [];
  return (key) => {
    recent.push(key.length === 1 ? key.toLowerCase() : key);
    if (recent.length > KONAMI_CODE.length) recent.shift();
    const done =
      recent.length === KONAMI_CODE.length && KONAMI_CODE.every((k, i) => recent[i] === k);
    if (done) recent.length = 0;
    return done;
  };
}
