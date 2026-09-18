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
 * Theme state. Dark is the default; the toggle is explicit and persisted.
 *
 * The initial class is applied by the inline script in src/app.html before
 * first paint -- this store only keeps the reactive side in sync. Both use
 * the same `themeSelected` localStorage key and light/dark values as the
 * Angular app, so an existing user's preference carries over.
 *
 * Note the `.svelte.ts` extension: $state/$derived are a compile error in a
 * plain .ts file.
 */
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'themeSelected';

function readInitial(): Theme {
  if (typeof document === 'undefined') return 'dark';
  // Trust the class the inline script already applied, so we never disagree
  // with what is on screen.
  return document.documentElement.classList.contains('light-theme') ? 'light' : 'dark';
}

class ThemeStore {
  #theme = $state<Theme>(readInitial());

  get current(): Theme {
    return this.#theme;
  }

  get isLight(): boolean {
    return this.#theme === 'light';
  }

  set(theme: Theme) {
    this.#theme = theme;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('light-theme', theme === 'light');
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private mode or a partitioned iframe: the toggle still works for
      // this page view, it just will not persist.
    }
  }

  toggle() {
    this.set(this.#theme === 'light' ? 'dark' : 'light');
  }
}

export const theme = new ThemeStore();
