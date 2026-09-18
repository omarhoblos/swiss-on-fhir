<!--
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
-->

While this application is designed to be as server agnostic as possible, you may need to tweak your server settings based on the FHIR server you use. If you don't see your server listed and would like to contribute to setup instructions, feel free to submit a pull request! The more the merrier :)

## Smile CDR

# Testing Backend Services

A backend services launch uses the `client_credentials` grant with a signed JWT instead of a user login. The OIDC client definition that Swiss uses for it needs a few settings the interactive launches don't.

First, in Swiss, open **Launch → Backend services** and generate a signing key (RS384 or ES384). Copy the **Public JWKS** it shows. The private key never leaves the browser.

> **Note:** Don't enable more than one type of auth flow on the same client definition. For example, don't add Client Credentials to the client you use for standalone or EHR launches. The flows conflict with one another and cause validation issues. Create a separate client definition for backend services, and switch Swiss's Client ID to it on the **Config** page when you test this flow.

Then, in Smile CDR, open the OIDC client definition whose Client ID matches Swiss's `CLIENT_ID` and change the following settings:

- Add **Client Credentials** to the authorized grant types
- Paste the public JWKS from Swiss into the client's public JWKS field. If your version only takes a JWKS URL, see the note under **Public JWKS** in Swiss for serving it from the Swiss origin.
- Add the `system/` scopes you intend to request to the **Auto-Approve Scopes** field, space-separated on one line (e.g. `system/*.read system/*.write`). There is no user to approve them, so they must be auto-approved.
- In the client's **Roles and Permissions** section, under **Roles**, turn on **FHIR Client (Superuser)** (`ROLE_FHIR_CLIENT_SUPERUSER`). The permissions in this section only apply when the client authenticates on its own with client credentials, which is exactly the backend services case.
- Save the client definition

The permission is the step that is easy to miss. With client credentials there is no user whose permissions apply, so the client's own permissions decide what the token can do. SMART scopes only _narrow_ those permissions, they never grant anything. A client with the right scopes and no permissions gets a token that carries the scopes, then a `403 Forbidden` from the FHIR server on every request.

`ROLE_FHIR_CLIENT_SUPERUSER` lets the client perform any standard FHIR operation. It does not make the client a superuser anywhere else in Smile CDR, such as user management. That is fine for a test server. On a shared server, grant narrower permissions from the same section that cover only what you mean to test.

The token endpoint also needs CORS enabled for the Swiss origin, as described in **User Logout & Token Revocation** above.

# Testing EHR Launch

In an EHR launch, the EHR opens Swiss rather than the other way round. It passes two parameters on the URL: `iss`, its FHIR base URL, and `launch`, a one-time token for the patient or encounter that is open. Swiss then runs the authorization flow and receives that context with the token.

Use the client definition for your standalone launches, not the backend services one (see the note above), and check the following settings:

- The authorized grant types include **Authorization Code**
- The redirect URI is `http://localhost:4200/callback`. Swiss's **Config** page shows the exact value for your origin.
- The scopes the client may request include `launch`, alongside `openid`, `fhirUser` and the `patient/` or `user/` scopes you want to test
- Save the client definition

Then register Swiss's launch URL with whatever will play the EHR. Use `http://localhost:4200/launch`, or just `http://localhost:4200`: Swiss forwards `iss` and `launch` from the bare origin to the Launch page.

To trigger the launch you need something that acts as the EHR. Either use your EHR's own app launch with a patient selected, or test Swiss on its own first with the public [SMART App Launcher](https://launch.smarthealthit.org), which plays both the EHR and the authorization server. Typing `?iss=…&launch=…` into the address bar yourself only shows that Swiss reads the parameters, because the authorization server rejects a launch token it did not issue.

When the EHR opens Swiss, the **Launch** page should show:

- An **EHR launch detected** card with the `iss` and `launch` values
- A notice that the FHIR base is overridden for this session, if `iss` differs from your configured FHIR base. The override is not saved.
- Scopes rewritten from `launch/patient` to `launch` in the request summary. That is correct for an EHR launch, where the EHR supplies the context rather than the user picking it.

Click **Start launch**. Swiss does not start the flow on its own, so you can inspect the request first with **Preview the URL**.

After signing in, confirm the launch worked:

- **Session → Launch context** shows the patient, marked _from the token response (authoritative)_. A patient that only came from an ID token claim, or none at all, means the server is not returning the launch context properly.
- **Session → Granted vs requested scopes** shows `launch` as granted, with nothing listed as not granted
- **FHIR API → Quick queries → Patient** returns that patient with a `200`, which proves the token works against the FHIR server
- **Diagnostics**, run after the launch, fills in the checks that need a live session

If it fails:

- **Nothing happens when the EHR opens Swiss:** the launch URL points somewhere other than `/launch` or the bare origin, so the parameters are lost
- **You stay on the identity provider's error page:** the redirect URI in the client definition does not match Swiss's exactly
- **The token request fails with a CORS error:** CORS is not enabled for the Swiss origin, as described in **User Logout & Token Revocation** above
- **No patient in the launch context:** the client is not allowed the `launch` scope, or the launch was started without a patient selected


# User Logout & Token Revocation

Due to the way authentication is managed by Smile CDR, all cookies generated cannot be modified by the client application. Therefore, when logging out of the system we need to invoke the [User Logout Endpoint](https://smilecdr.com/docs/smart/smart_on_fhir_session_management.html#user-logout-endpoint) to revoke the session & tokens. Otherwise, the session will remain active, thus skipping the prompt for the user to log in again. However, in doing so, you'll need to ensure that your SMART Outbound Security Module is setup to properly enable this.

In your `smart_auth` module, change the following settings:

- Enable CORS (if this wasn't already enabled)
- Change the `*` in the allowed URLs to the **URL Swiss is running on (in this case, http://localhost:4200)**
- Save & Restart the module

# Federated Authorization Script (Required for Federated Auth Setups)

A sample script is available in [federatedscript.md](federatedscript.md). This contains the minimum permissions a typical deployment might need to properly setup user permissions. This goes into your OIDC Server Definition's Authorization Script section.

If you're using Smile CDR's Outbound Security Module in **Federated Mode**, the issuer will remain the same as your SMART Outbound security endpoint, as the application will be querying against Smile CDR, not your 3rd party IDP.

If you're using Smile CDR's Outbound Security Module in **Federated Mode**, you should be following the instructions laid out in the [tutorial](https://smilecdr.com/docs/tutorial_and_tour/federated_oauth2.html) for how to setup the callback script to capture your patient ID.

# Callback Scripts (Optional)

While scopes will enforce what the _application_ can do, it doesn't enforce the what the _user_ can do. To properly ensure a user account can only access certain resources, you'll need to use a callback script in your security module. If you're using a local install with Smile as the IDP, add the following to the Local Inbound Security Module's `Authentication Callback Script`:

```js
function onAuthenticateSuccess(theOutcome, theOutcomeFactory, theContext) {
  if (theOutcome?.defaultLaunchContexts?.length > 0) {
    let patientId = theOutcome.defaultLaunchContexts[0]['resourceId'];
    Log.info('the Patient id: ' + patientId);
    theOutcome.addAuthority('FHIR_CAPABILITIES');
    theOutcome.addAuthority('FHIR_READ_ALL_IN_COMPARTMENT', 'Patient/' + patientId);
    theOutcome.addAuthority('FHIR_WRITE_ALL_IN_COMPARTMENT', 'Patient/' + patientId);
    theOutcome.addAuthority('FHIR_READ_ALL_OF_TYPE', 'Organization');
    theOutcome.addAuthority('FHIR_READ_ALL_OF_TYPE', 'Practitioner');
    theOutcome.addAuthority('FHIR_READ_ALL_OF_TYPE', 'Location');
    return theOutcome;
  }
}
```
