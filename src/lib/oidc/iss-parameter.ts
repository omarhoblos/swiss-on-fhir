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

import type { DiscoveryDocuments } from '$lib/smart/discovery';

/**
 * RFC 9207: the `iss` parameter on the authorization response.
 *
 * A client registered with two authorization servers cannot otherwise tell
 * which one sent it a code -- the "mix-up" attack. A server that advertises
 * `authorization_response_iss_parameter_supported` promises to name itself on
 * every response, and RFC 9207 §2.4 says the client compares that name to the
 * issuer it expected, byte for byte. Reported rather than enforced, like every
 * other conformance check in Swiss.
 */

/** Whether any discovery document advertised RFC 9207 support. */
export function advertisesIssParameter(docs: DiscoveryDocuments): boolean {
  return (
    docs['openid-configuration']?.authorization_response_iss_parameter_supported === true ||
    docs['smart-configuration']?.authorization_response_iss_parameter_supported === true
  );
}

export interface IssParameterCheckParams {
  /** The `iss` query parameter as it arrived, if at all. */
  received: string | null;
  /** The issuer discovery declared for the server this launch went to. */
  expectedIssuer?: string;
  /** Whether that server's discovery document advertised RFC 9207 support. */
  advertised: boolean;
}

export const RFC_9207_URL = 'https://www.rfc-editor.org/rfc/rfc9207';

export function checkIssParameter(params: IssParameterCheckParams): string[] {
  const { received, expectedIssuer, advertised } = params;

  if (!received) {
    return advertised
      ? [
          'The authorization server advertises `authorization_response_iss_parameter_supported` but sent no `iss` with the code. RFC 9207 requires it on every authorization response once advertised, and a client relying on it to detect a mix-up between servers would reject this response.'
        ]
      : [];
  }

  if (!expectedIssuer) {
    return [
      `The authorization response carried \`iss=${received}\`, but discovery declared no issuer, so it could not be compared.`
    ];
  }

  if (received !== expectedIssuer) {
    return [
      `The authorization response carried \`iss=${received}\`, which does not match the discovered issuer \`${expectedIssuer}\`. RFC 9207 requires an exact match; this is what a mix-up attack looks like, and a conforming client would discard the code.`
    ];
  }

  return [];
}
