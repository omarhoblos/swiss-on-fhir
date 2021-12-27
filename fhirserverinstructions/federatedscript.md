Add the following script to your application's OIDC Server Definition

```js
/**
 * This is a sample authentication callback script for the
 * SMART Outbound Security module, showing federated OAuth2/OIDC Login 
 *
 * @param theOutcome The outcome object. This contains details about the user that was created
 * 	in response to the incoming token.
 * @param theOutcomeFactory A factory object that can be used to create a new success or failure
 * 	object
 * @param theContext The login context. This object contains details about the authorized
 * 	scopes and claims
 * @returns {*} Either a successful outcome, or a failure outcome
 */
 function onAuthenticateSuccess(theOutcome, theOutcomeFactory, theContext) {

    // In this example we are demonstrating a patient-facing app, where the user corresponds to a FHIR Patient, and the
    // ID of that patient is passed back from the federated provider via a claim in the ID Token. Instead
    // the ID might be fetched using an HTTP call, or derived from something else.
    const patientId = theContext.getStringClaim('patientId');

    // Add a log line for troubleshooting
    Log.info("User " + theOutcome.getUsername() + " has authorized for " + patientId + " with scopes: " + theContext.getApprovedScopes());

    // All users can use the FHIR CapabilityStatement operation
    theOutcome.addAuthority('FHIR_CAPABILITIES');

    if (theContext.getStringClaim('role').toLowerCase() === 'superuser') {
        theOutcome.addAuthority('ROLE_SUPERUSER');
        theOutcome.addAuthority('ROLE_FHIR_CLIENT_SUPERUSER');
    }

    if (theContext.getStringClaim('role') === 'general_user') {
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

    // Set the launch context (in case the application has requested a SMART launch context scope). This should only
    // be set if the patient referenced by the ID is actually in context for this launch.  
    theOutcome.addLaunchResourceId('patient', patientId);

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
   return "EXT_USER:" + theOidcUserInfoMap['sub'];
}
```