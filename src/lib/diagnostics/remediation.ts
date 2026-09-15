import type { Remediation } from './types';

/**
 * Keyed remediation text, shared between diagnostics checks and live errors
 * so the same failure always reads the same way.
 *
 * The CORS and logout entries reproduce the guidance already in this
 * repository's fhirserverinstructions/fhirservers-smile.md, so a Smile CDR
 * user gets the project's own answer rather than a generic one.
 */
export const REMEDIATIONS: Record<string, Omit<Remediation, 'actions'>> = {
  'cors-missing-acao': {
    id: 'cors-missing-acao',
    label: 'The server is not allowing this page to read its responses (CORS)',
    body: `The request reached the server, but the browser will not let this page see the response because the server did not send an \`Access-Control-Allow-Origin\` header for this origin.

On Smile CDR, in the \`smart_auth\` module: enable CORS, and replace the \`*\` in the allowed-URLs setting with the URL Swiss is running on. Save and restart the module.

On other servers, look for a CORS or allowed-origins setting on the authorization endpoint and add this origin to it.

A wildcard \`*\` works for unauthenticated requests but not for credentialed ones, so prefer naming the origin explicitly.`
  },

  'cors-preflight-authorization': {
    id: 'cors-preflight-authorization',
    label: 'The CORS preflight for an Authorization header is failing',
    body: `Sending an \`Authorization\` header makes the browser issue an \`OPTIONS\` preflight before the real request. For that to succeed the server must:

- answer \`OPTIONS\` **without requiring authentication** (a 401 on the preflight fails the whole request), and
- include \`authorization\` in \`Access-Control-Allow-Headers\`.

This is a different setting from plain CORS on GET, which is why an unauthenticated request can succeed while an authenticated one fails.`
  },

  'mixed-content': {
    id: 'mixed-content',
    label: 'The browser is blocking a plaintext request from an HTTPS page',
    body: `Swiss is served over HTTPS and this endpoint is plaintext \`http\`. Browsers block that as mixed content before the request is ever sent, so no server-side change can fix it.

Either serve the endpoint over HTTPS, or run Swiss itself over \`http://localhost\` (which browsers treat as a secure context).`
  },

  'insecure-context-no-crypto': {
    id: 'insecure-context-no-crypto',
    label: 'This origin is not a secure context, so PKCE cannot work',
    body: `\`crypto.subtle\` is only available in a secure context, and Swiss needs it to compute the PKCE S256 code challenge.

\`http://localhost\` and \`http://127.0.0.1\` count as secure contexts. \`http://<your-lan-ip>\` does **not** — which is what the Swiss 2.x README recommended, so this is a common surprise.

Fix it by using \`http://localhost:4200\`, or by putting Swiss behind HTTPS. Falling back to \`plain\` PKCE is possible but forbidden by SMART 2.0.`
  },

  'private-network': {
    id: 'private-network',
    label: 'Chrome may block this private-network request',
    body: `This page is HTTPS and the target is a loopback or private (RFC1918) address. Chrome applies Private Network Access to that combination and sends an extra preflight, which can block the request even when ordinary CORS is configured correctly.

Running Swiss on the same network as the target, over plain HTTP, avoids this.`
  },

  'tls-or-unreachable': {
    id: 'tls-or-unreachable',
    label: 'The connection never completed',
    body: `Nothing answered: DNS did not resolve, nothing is listening on that port, the host refused the connection, or (for HTTPS) the certificate was rejected.

A rejected certificate looks identical to a dead host from JavaScript. Opening the URL in a new tab is the quickest way to tell them apart — the browser will show its own certificate warning if that is the cause.`
  },

  'issuer-mismatch': {
    id: 'issuer-mismatch',
    label: 'The discovery document declares a different issuer',
    body: `OpenID Connect Discovery requires the \`issuer\` in the document to be **byte-identical** to the URL it was fetched from. Yours is not, and a conforming client must reject the document.

This is almost always one of: a trailing slash, different host casing, or an explicit \`:443\`. Note that URL parsing always lowercases the host, so a mixed-case issuer cannot round-trip — this is the reason the \`skipIssuerCheck\` option exists in Swiss at all.

Prefer adopting the value the server declares. Disabling the check is non-compliant and only masks the mismatch.`
  },

  'redirect-uri-not-registered': {
    id: 'redirect-uri-not-registered',
    label: 'The redirect URI may not be registered',
    body: `This cannot be verified from the browser — only a real authorization attempt will tell you.

The symptom is distinctive and worth knowing: if the redirect URI is not registered, a conforming server **must not** redirect back to it. So you will land on an error page at the identity provider and never return to Swiss, which means Swiss cannot show you the error.

Register the exact string shown on the Configuration page. Trailing slashes and \`/index.html\` matter.`
  },

  'missing-aud': {
    id: 'missing-aud',
    label: 'The server may require the aud parameter',
    body: `SMART requires the authorize request to carry \`aud\` set to the FHIR base URL. Swiss sends it by default.

Servers differ on the exact form, and some reject an \`aud\` they do not recognise. If the authorize request is refused, try the trailing-slash variants under Testing options on the Configuration page.`
  },

  'refresh-not-enabled': {
    id: 'refresh-not-enabled',
    label: 'Refresh tokens are not enabled for this client',
    body: `You requested \`offline_access\` but the server does not advertise the \`refresh_token\` grant.

Enable the Refresh Token flow in your client definition. Without it you will get an access token but no refresh token, and the session will simply expire.`
  },

  'scope-not-granted': {
    id: 'scope-not-granted',
    label: 'The server granted different scopes than you asked for',
    body: `The \`scope\` value in the token response is what you actually hold, and it may be narrower than what you requested.

A server may drop a scope because it is not configured for this client, because the user did not consent to it, or because it normalised SMART 1.0 syntax to SMART 2.0. Swiss distinguishes those cases in the scope diff — a syntax normalisation is not a real reduction.`
  },

  'smart-config-missing': {
    id: 'smart-config-missing',
    label: 'No SMART configuration document',
    body: `\`/.well-known/smart-configuration\` was not served at the FHIR base. Swiss can still work from \`/.well-known/openid-configuration\` alone, but the server is not SMART-conformant without it, and SMART capabilities cannot be determined.

Some servers host it at the host root instead of the FHIR base. Swiss checks both and reports which one answered.`
  },

  'wrong-content-type': {
    id: 'wrong-content-type',
    label: 'The document was served with the wrong Content-Type',
    body: `The body parsed as JSON but the \`Content-Type\` was not a JSON type. Swiss accepts it anyway, since this misconfiguration is common, but a stricter client may refuse it.`
  },

  'no-logout-endpoint': {
    id: 'no-logout-endpoint',
    label: 'No end-session endpoint, so logout is local only',
    body: `The discovery document does not advertise \`end_session_endpoint\`, so Swiss can only discard its own tokens. **Your session at the identity provider stays active**, which means the next login may not prompt for credentials.

On Smile CDR this is expected: the documented approach is to invoke the user-logout endpoint to revoke the session and tokens. See \`fhirserverinstructions/fhirservers-smile.md\` in this repository.`
  }
};

export function remediation(id: string, actions?: Remediation['actions']): Remediation {
  const base = REMEDIATIONS[id];
  if (!base) {
    return { id, label: id, body: 'No remediation text is registered for this id.', actions };
  }
  return { ...base, actions };
}

export function remediations(ids: string[]): Remediation[] {
  return ids.map((id) => remediation(id));
}
