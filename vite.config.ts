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

import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
// Vitest's defineConfig, not Vite's: it is the one that accepts `test`.
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// SvelteKit 3 takes its options here; it no longer reads a svelte.config.js.
const kit = sveltekit({
  preprocess: vitePreprocess(),

  // Static SPA: every route falls back to index.html, which is what the
  // nginx `try_files $uri $uri/ /index.html` in the Dockerfile serves.
  adapter: adapter({
    pages: 'build',
    assets: 'build',
    fallback: 'index.html',
    precompress: false,
    strict: true
  }),

  // Exposes the app version via `import { version } from '$app/environment'`,
  // replacing the old `import packageJson from '../../package.json'` in the
  // footer (and the resolveJsonModule flag it needed).
  version: { name: pkg.version },

  // Defence in depth against script injection. SvelteKit hashes its own
  // inline start script; nothing else inline is allowed, which is why the
  // theme script lives in static/theme.js. frame-ancestors is not here
  // because a <meta> CSP cannot carry it: nginx sends that one.
  // connect-src is open because the whole point is talking to arbitrary
  // FHIR and authorization servers.
  csp: {
    mode: 'hash',
    directives: {
      'default-src': ['self'],
      'script-src': ['self'],
      'style-src': ['self', 'unsafe-inline'],
      // @ts-expect-error -- `*` is a valid source, but the types only know hosts with a dot in them.
      'connect-src': ['*'],
      'img-src': ['self', 'data:'],
      'object-src': ['none'],
      'base-uri': ['self'],
      'form-action': ['self']
    }
  }
});

export default defineConfig({
  plugins: [tailwindcss(), kit],

  // Port 4200 is deliberate, not a leftover. Every existing Swiss client
  // definition registers a redirect URI on http://localhost:4200, so moving
  // to Vite's default 5173 would break every reader of the README.
  server: { port: 4200, strictPort: true },
  preview: { port: 4200, strictPort: true },

  test: {
    include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.test.mjs'],
    environment: 'node'
  }
});
