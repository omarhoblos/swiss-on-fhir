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
 * What each JWT claim and header parameter means, for the token panels and
 * the glossary.
 *
 * Only what a specification defines is listed. Claims come from OpenID
 * Connect Core, the JWT and OAuth token RFCs access tokens draw on, and SMART
 * App Launch. Header parameters come from the JOSE RFCs -- JWS, JWE, JWA, JWT
 * and the unencoded-payload option -- which is every header parameter any of
 * those specifications uses; OpenID Connect and SMART only require some of
 * them. Anything else a server puts in a token is its own invention, and is
 * shown as such rather than guessed at -- a claim named `roles` means
 * whatever that server decided it means.
 *
 * The two are looked up separately because a name can mean different things
 * in each place: `typ` in the header is standard, while a `typ` claim (which
 * some identity providers add) is not.
 *
 * The definitions are paraphrased, and each links to the section it comes
 * from, which remains the authority.
 */

export const CUSTOM_CLAIM_MESSAGE =
  'This custom claim comes from your server & is not pre-defined in the spec.';

/** Where a name appears: the token's payload, or its JOSE header. */
export type ClaimKind = 'claim' | 'header';

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
const JWS_SPEC = 'JSON Web Signature (RFC 7515)';
const JWE_SPEC = 'JSON Web Encryption (RFC 7516)';
const JWA_SPEC = 'JSON Web Algorithms (RFC 7518)';
const B64_SPEC = 'JWS Unencoded Payload Option (RFC 7797)';
const rfc = (number: number, section: string) =>
  `https://www.rfc-editor.org/rfc/rfc${number}#section-${section}`;
const jws = (section: string): ClaimSource => ({
  spec: JWS_SPEC,
  section: `§${section}`,
  url: rfc(7515, section)
});
const jwe = (section: string): ClaimSource => ({
  spec: JWE_SPEC,
  section: `§${section}`,
  url: rfc(7516, section)
});
const jwa = (section: string): ClaimSource => ({
  spec: JWA_SPEC,
  section: `§${section}`,
  url: rfc(7518, section)
});
const replicated: ClaimSource = { spec: JWT_SPEC, section: '§5.3', url: rfc(7519, '5.3') };
const replicatedNote =
  'In an encrypted JWT the claims cannot be read until it is decrypted, so a copy can be placed in the header; it must match the claim inside.';

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

const HEADER_DEFINITIONS: ClaimDefinition[] = [
  // --- JSON Web Signature (RFC 7515) §4.1 -------------------------------------
  {
    name: 'alg',
    summary:
      'The algorithm used to sign the token (or, in an encrypted token, to protect its key), such as RS256 or ES256.',
    detail:
      'A client should only accept the algorithms it expects. "none" means the token is not signed at all, which is never acceptable for an ID token.',
    source: jws('4.1.1')
  },
  {
    name: 'jku',
    summary: 'A URL for a JWK Set that contains the key the token was signed with.',
    detail:
      "Only to be trusted when it points somewhere the client already expects, such as the issuer's own jwks_uri; otherwise anyone could supply their own key.",
    source: jws('4.1.2')
  },
  {
    name: 'jwk',
    summary: 'The public key the token was signed with, embedded in the header as a JWK.',
    detail:
      'Proves possession of a key rather than the identity of the signer, which is how DPoP proofs use it.',
    source: jws('4.1.3')
  },
  {
    name: 'kid',
    summary: "Key ID: which key in the issuer's key set signed the token.",
    detail:
      'The client looks this up in the JWKS it discovered. A kid missing from that set usually means the server rotated its keys.',
    source: jws('4.1.4')
  },
  {
    name: 'x5u',
    summary: 'A URL for the X.509 certificate chain of the key that signed the token.',
    source: jws('4.1.5')
  },
  {
    name: 'x5c',
    summary:
      'The X.509 certificate chain of the signing key, embedded in the header, signing certificate first.',
    source: jws('4.1.6')
  },
  {
    name: 'x5t',
    summary: "A SHA-1 thumbprint of the signing key's X.509 certificate.",
    source: jws('4.1.7')
  },
  {
    name: 'x5t#S256',
    summary: "A SHA-256 thumbprint of the signing key's X.509 certificate.",
    source: jws('4.1.8')
  },
  {
    name: 'typ',
    summary: 'The type of the whole token, such as JWT.',
    detail:
      'Profiles use it to stop one kind of token passing for another: at+jwt marks a JWT access token (RFC 9068) and dpop+jwt a DPoP proof.',
    source: jws('4.1.9')
  },
  {
    name: 'cty',
    summary: 'The type of the payload. "JWT" means the payload is itself another, nested JWT.',
    source: jws('4.1.10')
  },
  {
    name: 'crit',
    summary:
      'A list of header parameters the recipient must understand; if it does not know one of them, it must reject the token.',
    source: jws('4.1.11')
  },

  // --- JSON Web Encryption (RFC 7516) §4.1 -----------------------------------
  {
    name: 'enc',
    summary: 'In an encrypted token, the algorithm used to encrypt the content, such as A256GCM.',
    detail: 'Its presence means the token is a JWE: encrypted rather than only signed.',
    source: jwe('4.1.2')
  },
  {
    name: 'zip',
    summary:
      'In an encrypted token, the compression applied before encrypting. "DEF" means DEFLATE.',
    source: jwe('4.1.3')
  },

  // --- JSON Web Algorithms (RFC 7518): algorithm-specific parameters --------
  {
    name: 'epk',
    summary:
      'Ephemeral public key: the one-time key the sender generated for an ECDH-ES key agreement.',
    source: jwa('4.6.1.1')
  },
  {
    name: 'apu',
    summary:
      'Agreement PartyUInfo: information about the sender, mixed into an ECDH-ES key agreement.',
    source: jwa('4.6.1.2')
  },
  {
    name: 'apv',
    summary:
      'Agreement PartyVInfo: information about the recipient, mixed into an ECDH-ES key agreement.',
    source: jwa('4.6.1.3')
  },
  {
    name: 'iv',
    summary: 'The initialization vector used to wrap the encryption key with AES-GCM.',
    source: jwa('4.7.1.1')
  },
  {
    name: 'tag',
    summary: 'The authentication tag from wrapping the encryption key with AES-GCM.',
    source: jwa('4.7.1.2')
  },
  {
    name: 'p2s',
    summary: 'The salt used to derive a key from a password with PBES2.',
    source: jwa('4.8.1.1')
  },
  {
    name: 'p2c',
    summary: 'The number of iterations used to derive a key from a password with PBES2.',
    source: jwa('4.8.1.2')
  },

  // --- JSON Web Token (RFC 7519) §5.3: claims replicated in the header ------
  {
    name: 'iss',
    summary: 'A copy of the iss claim: who issued the token.',
    detail: replicatedNote,
    source: replicated
  },
  {
    name: 'sub',
    summary: 'A copy of the sub claim: who the token is about.',
    detail: replicatedNote,
    source: replicated
  },
  {
    name: 'aud',
    summary: 'A copy of the aud claim: who the token is intended for.',
    detail: replicatedNote,
    source: replicated
  },

  // --- JWS Unencoded Payload Option (RFC 7797) ------------------------------
  {
    name: 'b64',
    summary: 'false means the payload is used as-is rather than base64url-encoded before signing.',
    detail:
      'It must also be listed in crit, so a recipient that does not support it rejects the token.',
    source: { spec: B64_SPEC, section: '§3', url: rfc(7797, '3') }
  }
];

/**
 * Maps rather than objects: these names come from the server, and an object
 * lookup would find `constructor` or `__proto__` on the prototype.
 */
export const CLAIMS: ReadonlyMap<string, ClaimDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.name, definition])
);

export const HEADER_PARAMETERS: ReadonlyMap<string, ClaimDefinition> = new Map(
  HEADER_DEFINITIONS.map((definition) => [definition.name, definition])
);

const BY_KIND: Record<
  ClaimKind,
  { map: ReadonlyMap<string, ClaimDefinition>; list: ClaimDefinition[] }
> = {
  claim: { map: CLAIMS, list: DEFINITIONS },
  header: { map: HEADER_PARAMETERS, list: HEADER_DEFINITIONS }
};

export type ClaimDescription =
  { known: true; definition: ClaimDefinition } | { known: false; text: string };

export function describeClaim(name: string, kind: ClaimKind = 'claim'): ClaimDescription {
  const definition = BY_KIND[kind].map.get(name);
  return definition ? { known: true, definition } : { known: false, text: CUSTOM_CLAIM_MESSAGE };
}

/** The definition as one piece of text, for hover text. */
export function claimText(name: string, kind: ClaimKind = 'claim'): string {
  const description = describeClaim(name, kind);
  if (!description.known) return description.text;
  const { summary, detail } = description.definition;
  return detail ? `${summary} ${detail}` : summary;
}

/** Every definition of a kind, grouped by the specification it comes from, in listing order. */
export function claimGroups(
  kind: ClaimKind = 'claim'
): { spec: string; claims: ClaimDefinition[] }[] {
  const groups = new Map<string, ClaimDefinition[]>();
  for (const definition of BY_KIND[kind].list) {
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
