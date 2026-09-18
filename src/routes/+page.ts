import { redirect } from '@sveltejs/kit';

/**
 * An EHR launch lands wherever the EHR was told Swiss lives, and the bare
 * origin is the natural thing to register. Only /launch reads `iss` and
 * `launch`, so forward them there with the query intact rather than showing
 * the Session page and silently dropping the launch.
 */
export function load({ url }) {
  if (url.searchParams.has('iss') || url.searchParams.has('launch')) {
    redirect(307, `/launch${url.search}`);
  }
}
