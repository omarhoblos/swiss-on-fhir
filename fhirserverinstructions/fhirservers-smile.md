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

# User Logout & Token Revocation

Due to the way authentication is managed by Smile CDR, all cookies generated cannot be modified by the client application. Therefore, when logging out of the system we need to invoke the [User Logout Endpoint](https://smilecdr.com/docs/smart/smart_on_fhir_session_management.html#user-logout-endpoint) to revoke the session & tokens. Otherwise, the session will remain active, thus skipping the prompt for the user to log in again. However, in doing so, you'll need to ensure that your SMART Outbound Security Module is setup to properly enable this. 

In your `smart_auth` module, change the following settings:

* Enable CORS (if this wasn't already enabled)
* Change the `*` in the allowed URLs to the **URL Swiss is running on (in this case, http://localhost:4200)**
* Save & Restart the module

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
      Log.info("the Patient id: " + patientId)
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

