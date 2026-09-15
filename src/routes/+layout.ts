/**
 * Static SPA. `ssr: false` is what makes this a client-only app; the
 * adapter-static `fallback: 'index.html'` in svelte.config.js is what lets
 * non-prerenderable routes exist at all.
 *
 * `prerender: false` is deliberate: a prerendered page would bake build-time
 * state into the output, which is exactly the "config is baked into the
 * build" problem the runtime config system exists to avoid. It also means no
 * load function here may read url.searchParams -- /callback and /launch read
 * their query parameters in the component instead.
 */
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';
