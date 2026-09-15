import { redirect } from '@sveltejs/kit';

/** Legacy route from the Angular app; the console now lives at /fhir. */
export function load() {
  redirect(307, '/fhir');
}
