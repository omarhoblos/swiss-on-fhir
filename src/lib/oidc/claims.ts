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

/**
 * What each JWT claim means, for the token panels and the claims glossary.
 *
 * Only claims a specification defines are listed: OpenID Connect Core, the
 * JWT and OAuth token RFCs access tokens draw on, and SMART App Launch.
 * Anything else a server puts in a token is its own invention, and is shown
 * as such rather than guessed at -- a claim named `roles` means whatever that
 * server decided it means.
 *
 * The definitions are paraphrased, and each links to the section it comes
 * from, which remains the authority.
 */

export const CUSTOM_CLAIM_MESSAGE =
  'This custom claim comes from your server & is not pre-defined in the spec.';

export interface ClaimSource {
  spec: string;
  section: string;
  url: string;
}

export interface ClaimDefinition {
  name: string;
  /** One sentence. */
  summary: string;
  /** What it is for, or what to check, when that is not obvious. */
  detail?: string;
  source: ClaimSource;
}

const OIDC_SPEC = 'OpenID Connect Core 1.0';
const OIDC_URL = 'https://openid.net/specs/openid-connect-core-1_0.html';
const JWT_SPEC = 'JSON Web Token (RFC 7519)';
const TOKEN_EXCHANGE_SPEC = 'OAuth 2.0 Token Exchange (RFC 8693)';
const LOGOUT_SPEC = 'OpenID Connect Front-Channel Logout 1.0';
const SMART_SPEC = 'SMART App Launch';
const SMART_URL = 'https://hl7.org/fhir/smart-app-launch/scopes-and-launch-context.html';

const idToken: ClaimSource = { spec: OIDC_SPEC, section: '§2', url: `${OIDC_URL}#IDToken` };
const standard: ClaimSource = {
  spec: OIDC_SPEC,
  section: '§5.1',
  url: `${OIDC_URL}#StandardClaims`
};
const smartContext: ClaimSource = {
  spec: SMART_SPEC,
  section: 'Launch context',
  url: `${SMART_URL}#launch-context-arrives-with-your-access_token`
};
const smartContextNote =
  'SMART defines this as a field of the token response rather than a claim; some servers also copy it into the token.';

const DEFINITIONS: ClaimDefinition[] = [
  // --- OpenID Connect Core §2: the ID token ---------------------------------
  {
    name: 'iss',
    summary: 'The issuer: the authorization server that created and signed this token.',
    detail:
      'A client compares it, character for character, with the issuer it discovered, and rejects the token if they differ.',
    source: idToken
  },
  {
    name: 'sub',
    summary:
      'The subject: a stable identifier for the user, unique within the issuer and never reassigned.',
    detail:
      'Together with iss it is the only reliable key for a user; names and other profile values can change.',
    source: idToken
  },
  {
    name: 'aud',
    summary:
      'The audience: who this token is intended for. For an ID token it must contain the client ID.',
    detail:
      'It may be a single string or a list. A client rejects a token whose audience does not include it.',
    source: idToken
  },
  {
    name: 'exp',
    summary:
      'The expiry time, in seconds since 1970 (UTC), after which the token must not be accepted.',
    source: idToken
  },
  {
    name: 'iat',
    summary: 'The time the token was issued, in seconds since 1970 (UTC).',
    source: idToken
  },
  {
    name: 'auth_time',
    summary: 'When the user last actively signed in, in seconds since 1970 (UTC).',
    detail:
      'Required when the client asked for it or sent max_age. It can be older than iat when an existing sign-in session was reused.',
    source: idToken
  },
  {
    name: 'nonce',
    summary:
      'A random value the client sent on the authorization request, echoed back unchanged in the ID token.',
    detail:
      'It binds the token to that request, so a token captured from another sign-in cannot be replayed. A mismatch means the token must be rejected.',
    source: idToken
  },
  {
    name: 'acr',
    summary:
      'Authentication Context Class Reference: the level or class of authentication the user went through.',
    detail:
      'Its values are agreed between client and server, for example to show multi-factor was used.',
    source: idToken
  },
  {
    name: 'amr',
    summary:
      'Authentication Methods References: a list of the methods used to sign the user in, such as a password or one-time code.',
    source: idToken
  },
  {
    name: 'azp',
    summary: 'Authorized party: the client ID the token was issued to.',
    detail:
      'Needed when the audience holds more than one value, so it is clear which of them requested the token.',
    source: idToken
  },
  {
    name: 'at_hash',
    summary:
      'A hash of the access token issued alongside this ID token, which ties the two together.',
    detail:
      'Half of the hash of the access token, base64url-encoded, using the hash algorithm the ID token is signed with.',
    source: { spec: OIDC_SPEC, section: '§3.1.3.6', url: `${OIDC_URL}#CodeIDToken` }
  },
  {
    name: 'c_hash',
    summary:
      'A hash of the authorization code, used in the hybrid flow to tie the code to this ID token.',
    source: { spec: OIDC_SPEC, section: '§3.3.2.11', url: `${OIDC_URL}#HybridIDToken` }
  },

  // --- OpenID Connect Core §5.1: standard claims about the user --------------
  {
    name: 'name',
    summary: "The user's full name, in a form suitable for display.",
    source: standard
  },
  { name: 'given_name', summary: "The user's given or first name.", source: standard },
  { name: 'family_name', summary: "The user's surname or last name.", source: standard },
  { name: 'middle_name', summary: "The user's middle name or names.", source: standard },
  { name: 'nickname', summary: 'A casual name the user goes by.', source: standard },
  {
    name: 'preferred_username',
    summary: 'The shorthand name the user prefers to be called, such as a login handle.',
    detail: 'It is not guaranteed to be unique or stable, so it must not be used as an identifier.',
    source: standard
  },
  { name: 'profile', summary: "The URL of the user's profile page.", source: standard },
  { name: 'picture', summary: 'The URL of a picture of the user.', source: standard },
  { name: 'website', summary: "The URL of the user's web page or blog.", source: standard },
  {
    name: 'email',
    summary: "The user's preferred email address.",
    detail: 'Not necessarily unique or verified; see email_verified.',
    source: standard
  },
  {
    name: 'email_verified',
    summary: 'Whether the issuer has confirmed the user controls that email address.',
    source: standard
  },
  { name: 'gender', summary: "The user's gender.", source: standard },
  {
    name: 'birthdate',
    summary: "The user's date of birth, as YYYY-MM-DD (or just YYYY).",
    source: standard
  },
  {
    name: 'zoneinfo',
    summary: "The user's time zone, as a tz database name such as America/Toronto.",
    source: standard
  },
  {
    name: 'locale',
    summary: "The user's language and region, as a language tag such as en-CA.",
    source: standard
  },
  {
    name: 'phone_number',
    summary: "The user's preferred telephone number, ideally in international format.",
    source: standard
  },
  {
    name: 'phone_number_verified',
    summary: 'Whether the issuer has confirmed the user controls that telephone number.',
    source: standard
  },
  {
    name: 'address',
    summary:
      "The user's postal address, as an object with fields such as street_address, locality and country.",
    source: { spec: OIDC_SPEC, section: '§5.1.1', url: `${OIDC_URL}#AddressClaim` }
  },
  {
    name: 'updated_at',
    summary: "When the user's profile information was last changed, in seconds since 1970 (UTC).",
    source: standard
  },

  // --- JWT and OAuth access token RFCs -------------------------------------
  {
    name: 'nbf',
    summary: 'Not before: the time before which the token must not be accepted.',
    source: {
      spec: JWT_SPEC,
      section: '§4.1.5',
      url: 'https://www.rfc-editor.org/rfc/rfc7519#section-4.1.5'
    }
  },
  {
    name: 'jti',
    summary: 'A unique identifier for this token.',
    detail: 'Lets a server spot a token being replayed, or revoke one specific token.',
    source: {
      spec: JWT_SPEC,
      section: '§4.1.7',
      url: 'https://www.rfc-editor.org/rfc/rfc7519#section-4.1.7'
    }
  },
  {
    name: 'scope',
    summary: 'The scopes this token grants, as one space-separated string.',
    detail:
      'Also used in JWT access tokens (RFC 9068). It can be narrower than what was requested; the Granted vs Requested Scopes card compares them.',
    source: {
      spec: TOKEN_EXCHANGE_SPEC,
      section: '§4.2',
      url: 'https://www.rfc-editor.org/rfc/rfc8693#section-4.2'
    }
  },
  {
    name: 'client_id',
    summary: 'The OAuth client the token was issued to.',
    detail: 'Also used in JWT access tokens (RFC 9068).',
    source: {
      spec: TOKEN_EXCHANGE_SPEC,
      section: '§4.3',
      url: 'https://www.rfc-editor.org/rfc/rfc8693#section-4.3'
    }
  },
  {
    name: 'sid',
    summary: "Session ID: identifies the user's sign-in session at the authorization server.",
    detail:
      'Used to match logout requests to the right session; the back-channel logout specification uses it the same way.',
    source: {
      spec: LOGOUT_SPEC,
      section: '§3',
      url: 'https://openid.net/specs/openid-connect-frontchannel-1_0.html#ClaimsContents'
    }
  },

  // --- SMART App Launch ------------------------------------------------------
  {
    name: 'fhirUser',
    summary:
      'The FHIR resource that represents the signed-in user, such as Patient/123 or Practitioner/456.',
    detail:
      'Returned in the ID token when the fhirUser scope is granted. It may be absolute or relative to the FHIR base.',
    source: {
      spec: SMART_SPEC,
      section: 'Identity data',
      url: `${SMART_URL}#scopes-for-requesting-identity-data`
    }
  },
  {
    name: 'patient',
    summary: 'The ID of the patient in context for this launch.',
    detail: smartContextNote,
    source: smartContext
  },
  {
    name: 'encounter',
    summary: 'The ID of the encounter in context for this launch.',
    detail: smartContextNote,
    source: smartContext
  },
  {
    name: 'fhirContext',
    summary: 'References to other FHIR resources in context for this launch.',
    detail: smartContextNote,
    source: smartContext
  }
];

/**
 * A Map rather than an object: claim names come from the server, and an
 * object lookup would find `constructor` or `__proto__` on the prototype.
 */
export const CLAIMS: ReadonlyMap<string, ClaimDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.name, definition])
);

export type ClaimDescription =
  { known: true; definition: ClaimDefinition } | { known: false; text: string };

export function describeClaim(name: string): ClaimDescription {
  const definition = CLAIMS.get(name);
  return definition ? { known: true, definition } : { known: false, text: CUSTOM_CLAIM_MESSAGE };
}

/** The definition as one piece of text, for hover text. */
export function claimText(name: string): string {
  const description = describeClaim(name);
  if (!description.known) return description.text;
  const { summary, detail } = description.definition;
  return detail ? `${summary} ${detail}` : summary;
}

/** Every definition, grouped by the specification it comes from, in listing order. */
export function claimGroups(): { spec: string; claims: ClaimDefinition[] }[] {
  const groups = new Map<string, ClaimDefinition[]>();
  for (const definition of DEFINITIONS) {
    const list = groups.get(definition.source.spec) ?? [];
    list.push(definition);
    groups.set(definition.source.spec, list);
  }
  return [...groups].map(([spec, claims]) => ({ spec, claims }));
}

/** Case-insensitive match on the name, the meaning, or the specification. */
export function matchesClaim(definition: ClaimDefinition, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    definition.name,
    definition.summary,
    definition.detail ?? '',
    definition.source.spec
  ].some((text) => text.toLowerCase().includes(needle));
}
