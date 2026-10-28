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

import { vi } from 'vitest';

/** A Web Storage in memory, for unit tests that run in Node. */
export class MemoryStorage implements Storage {
  #items = new Map<string, string>();

  get length(): number {
    return this.#items.size;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#items.set(key, String(value));
  }

  removeItem(key: string): void {
    this.#items.delete(key);
  }

  clear(): void {
    this.#items.clear();
  }
}

/**
 * Installs fresh localStorage and sessionStorage globals and returns them.
 * Call in `beforeEach`; `vi.unstubAllGlobals()` in `afterEach` removes them.
 */
export function stubStorages(): { local: MemoryStorage; session: MemoryStorage } {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  return { local, session };
}
