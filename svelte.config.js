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

import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
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
        'connect-src': ['*'],
        'img-src': ['self', 'data:'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self']
      }
    },

    alias: {
      $config: 'src/lib/config',
      $components: 'src/lib/components'
    }
  }
};

export default config;
