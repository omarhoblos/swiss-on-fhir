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

    alias: {
      $config: 'src/lib/config',
      $components: 'src/lib/components'
    }
  }
};

export default config;
