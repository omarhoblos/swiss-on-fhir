import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
// Vitest's defineConfig, not Vite's: it is the one that accepts `test`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],

  // Port 4200 is deliberate, not a leftover. Every existing Swiss client
  // definition registers a redirect URI on http://localhost:4200, so moving
  // to Vite's default 5173 would break every reader of the README.
  server: { port: 4200, strictPort: true },
  preview: { port: 4200, strictPort: true },

  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'node'
  }
});
