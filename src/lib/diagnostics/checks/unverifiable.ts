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

import { remediation } from '../remediation';
import { result, type Check } from '../types';

/**
 * Checks that cannot be performed from a browser, listed explicitly.
 *
 * A diagnostics panel that quietly omits these is worse than one that admits
 * them: the user is left assuming a clean run means everything is verified.
 * Each of these names the limitation and points at the best available
 * alternative.
 */

const clientRegistration: Check = {
  id: 'manual.client-registration',
  title: 'Client ID and secret are correct',
  group: 'environment',
  async run() {
    return result({
      status: 'manual',
      summary: 'Not directly verifiable, but the token endpoint probe gets most of the way there.',
      detail:
        'The CORS probe under "Token endpoint" sends a deliberately invalid authorization code. Read its error code:\n\n- `invalid_client` means your `client_id` or secret is wrong.\n- `invalid_grant` means the server **recognised your client** and only rejected the fake code.\n\nThat distinction is otherwise unobtainable from a browser without completing a full login.'
    });
  }
};

const preflightDetail: Check = {
  id: 'manual.preflight-detail',
  title: 'CORS preflight response detail',
  group: 'cors',
  async run() {
    return result({
      status: 'manual',
      summary:
        'The browser will not show JavaScript the OPTIONS response, so the preflight headers cannot be inspected here.',
      detail:
        'Swiss infers preflight problems by comparing a request with and without an `Authorization` header, which identifies *that* the preflight fails but not which header is missing.\n\nTo see the actual response, use the curl command offered on a failing CORS check, or open the devtools Network tab and look at the `OPTIONS` request.'
    });
  }
};

const tlsCertificate: Check = {
  id: 'manual.tls-certificate',
  title: 'TLS certificate is valid',
  group: 'environment',
  async run() {
    return result({
      status: 'manual',
      summary:
        'Invisible to JavaScript: a rejected certificate is indistinguishable from a dead host.',
      detail:
        'Both surface as the same opaque `TypeError: Failed to fetch`.\n\nOpening the endpoint in a new tab is genuinely the best available tool here -- the browser will show its own certificate interstitial if that is the problem.',
      remediations: [remediation('tls-or-unreachable')]
    });
  }
};

const clockSkew: Check = {
  id: 'manual.clock-skew',
  title: 'Server clock is accurate',
  group: 'environment',
  async run() {
    return result({
      status: 'manual',
      summary: 'Only inferable, never measurable.',
      detail:
        'After a successful launch Swiss compares the token response’s `expires_in` against the access token’s `exp` claim and the local clock, and warns when they disagree by more than about 30 seconds.\n\nSkew matters because it causes JWT validation failures elsewhere in your stack that look like signature problems.'
    });
  }
};

const cookieBehaviour: Check = {
  id: 'manual.cookie-behaviour',
  title: 'Identity provider session cookies',
  group: 'environment',
  async run() {
    return result({
      status: 'manual',
      summary:
        'Not observable from this page, but it is what actually breaks session reuse and silent renew.',
      detail:
        'Third-party cookie blocking is why iframe-based silent renew no longer works in practice; Swiss uses refresh tokens instead.\n\nIt is also why a "logout" that clears only local tokens leaves you silently logged back in: your session cookie at the identity provider is still valid. Swiss reports which logout path it was able to take.'
    });
  }
};

export const unverifiableChecks: Check[] = [
  clientRegistration,
  preflightDetail,
  tlsCertificate,
  clockSkew,
  cookieBehaviour
];
