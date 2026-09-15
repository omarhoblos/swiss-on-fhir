import { capabilityChecks } from './capabilities';
import { corsChecks } from './cors';
import { discoveryChecks } from './discovery';
import { environmentChecks } from './environment';
import { unverifiableChecks } from './unverifiable';
import type { Check } from '../types';

/**
 * Check order is the narrative: environment first (no network, instant), then
 * can we reach and parse the discovery documents, then does the server
 * support what we intend to ask for, then can the browser actually talk to
 * the endpoints that matter.
 */
export const ALL_CHECKS: Check[] = [
  ...environmentChecks,
  ...discoveryChecks,
  ...capabilityChecks,
  ...corsChecks,
  ...unverifiableChecks
];

export { capabilityChecks, corsChecks, discoveryChecks, environmentChecks, unverifiableChecks };
