import type { AppConfig } from './types';

/**
 * Baked defaults: the bottom layer, used when neither the runtime file nor a
 * live override supplies a value.
 *
 * `clientSecret` is empty on purpose. Swiss 2.x shipped a working
 * `secrettest` secret in both .env and assets/env.js, and the README told
 * users to register it.
 */
export const DEFAULTS: AppConfig = {
  fhirBaseUrl: 'http://localhost:8000',
  authIssuer: 'http://localhost:9200',
  clientId: 'swiss',
  clientSecret: '',
  scopes: 'openid fhirUser offline_access launch/patient patient/*.read patient/*.write',
  skipIssuerCheck: false,

  clientAuthMethod: 'none',
  audMode: 'exact',
  scopeSyntax: 'auto',
  tokenStorage: 'session',
  redactSecrets: true
};
