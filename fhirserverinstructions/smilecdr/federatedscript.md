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

# Federated OAuth Script

Add the following script to your application's OIDC Server Definition

```js
/**
 * This is a sample authentication callback script for the
 * SMART Outbound Security module, showing federated OAuth2/OIDC Login
 *
 * @param theOutcome The outcome object. This contains details about the user that was created
 * in response to the incoming token.
 * @param theOutcomeFactory A factory object that can be used to create a new success or failure
 * object
 * @param theContext The login context. This object contains details about the authorized
 * scopes and claims
 * @returns {*} Either a successful outcome, or a failure outcome
 */
function onAuthenticateSuccess(theOutcome, theOutcomeFactory, theContext) {
  // Claims below come from the ID Token issued by Keycloak. Note that 'scope' is not one of them
  // (it lives in the access token), and getApprovedScopes() is empty here because the user has not
  // reached the consent screen yet.
  var patientId = theContext.getStringClaim('patientId');

  // Keycloak's realm-role mapper emits 'roles' as a multi-valued claim, so it must be read with
  // getStringArrayClaim. The list also contains Keycloak's own default roles (offline_access,
  // uma_authorization, ...), so always test for a specific role rather than reading roles[0].
  var roles = theContext.getStringArrayClaim('roles');
  var hasRole = function (theRole) {
    if (!roles) {
      return false;
    }
    var count = typeof roles.size === 'function' ? roles.size() : roles.length;
    for (var i = 0; i < count; i++) {
      var role = typeof roles.get === 'function' ? roles.get(i) : roles[i];
      if (role != null && String(role).toLowerCase() === theRole.toLowerCase()) {
        return true;
      }
    }
    return false;
  };

  // Add a log line for troubleshooting
  Log.info(
    'User ' + theOutcome.getUsername() + ' has authorized for ' + patientId + ' with roles: ' + roles
  );

  // All users can use the FHIR CapabilityStatement operation
  theOutcome.addAuthority('FHIR_CAPABILITIES');

  if (hasRole('superuser')) {
    theOutcome.addAuthority('ROLE_SUPERUSER');
    theOutcome.addAuthority('ROLE_FHIR_CLIENT_SUPERUSER');
  }

  if (hasRole('general_user') && patientId) {
    theOutcome.addAuthority('FHIR_READ_ALL_IN_COMPARTMENT', 'Patient/' + patientId);
    theOutcome.addAuthority('FHIR_WRITE_ALL_IN_COMPARTMENT', 'Patient/' + patientId);

    // Despite the name, this operation is only used to grab related resources that are referenced in other FHIR data for the Patient
    // For example, grabbing a Practitioner listed in an ExplanationOfBenefit
    theOutcome.addAuthority('FHIR_OP_PATIENT_EVERYTHING');
  }

  // Basic authorities all users need to have
  theOutcome.addAuthority('FHIR_READ_ALL_OF_TYPE', 'Organization');
  theOutcome.addAuthority('FHIR_READ_ALL_OF_TYPE', 'Location');
  theOutcome.addAuthority('FHIR_READ_ALL_OF_TYPE', 'Practitioner');

  // Keycloak does not emit an 'identifier' claim today; add a mapper for it to populate this.
  // getStringClaim returns null when the claim is absent, so guard before using it.
  var identifier = theContext.getStringClaim('identifier');
  if (identifier) {
    theOutcome.setUserData('federated_detail', identifier);
  }

  // Set the launch context (in case the application has requested a SMART launch context scope). This should only
  // be set if the patient referenced by the ID is actually in context for this launch.
  if (patientId) {
    theOutcome.addLaunchResourceId('patient', patientId);
  }

  return theOutcome;
}
```

If you plan on using the User Mapping script section to map usernames from the IDP, you can use the following sample to get started:

```js
/**
 * This is a sample user name mapping callback script
 *
 * @param theOidcUserInfoMap OIDC claims from the token as a map
 *
 * @param theServerInfo JSON mapping of the OAuth server defintion (backed by ca.cdr.api.model.json.OAuth2ServerJson)
 *
 * @returns Local unique Smile CDR user name for the enternal user.  
 */
function getUserName(theOidcUserInfoMap, theServerInfo) {
  return 'EXT_USER:' + theOidcUserInfoMap['sub'];
}
```
