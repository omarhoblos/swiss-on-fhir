# Swiss On FHIR

[![Docker Image CI](https://github.com/omarhoblos/swiss-on-fhir/actions/workflows/docker-image.yml/badge.svg?branch=main)](https://github.com/omarhoblos/swiss-on-fhir/actions/workflows/docker-image.yml) [![CodeQL](https://github.com/omarhoblos/swiss-on-fhir/actions/workflows/codeql-analysis.yml/badge.svg?branch=main)](https://github.com/omarhoblos/swiss-on-fhir/actions/workflows/codeql-analysis.yml)

The goal of this project is to provide developers & implementers with a tool to test their FHIR & OIDC servers, including what tokens are returned, and whether their permissions are properly being enforced when fetch data from their setup. 

<!-- TODO - UPDATE DOCUMENTATION -->
## Setup

This app is designed to query a Patient resource & resources related to it. A sample bundle is provided in [bundle.md](bundle.md). **If you plan on using the sample data provided in bundle.md, you should have a patient launch context of `patient-a`. In addition, your FHIR Server/ IDP needs to be able to map the patient record ID to a claim.**

This application depends on node.js (any version 8 or above, latest LTS preferred) to run this app locally. To adapt the application to your environment, edit the following settings in `assets/env.js`. Note, you should not edit `env.template.js`, as it is used exclusively for the Docker deployment.

```js
fhirEndpointUri: 'http://localhost:8000', // Replace this with your FHIR endpoint
clientId: 'swiss',
// clientSecret: 'secrettest', // Only include this if you can secure your application
scopes: 'fhirUser launch/patient openid patient/*.read patient/*.write offline_access',
logoutUri: 'http://localhost:9200/logout?cb=none&revoke=token&revoke=token_refresh', // Replace this with the logout endpoint for your server/ IDP 
issuer: 'http://localhost:9200' // Issuer that contains details about how to authenticate against your IDP
```
<!-- TODO - WRITE DISCLAIMER & WARNING FOR USERS WHO HAVE V1 CONFIGS -->
Make sure to add the following to your Client Definition for this to work:

* Client ID: `swiss`
* Client Secret: `secrettest` (optional)
* Authorization Flow: Code
* Redirect URL: `http://yourlocalip:4200/index.html`
* Scopes: scopes from the environment file 

Note that scopes can be modified to be whatever fits your test - just ensure that they're the same in the application, and in your client definition. Additionally, if you require Refresh tokens, you'll need to enabled Refresh Token flow in your Client Definition. 

> If you're serving the compiled version of this application, ensure that the program you're using to serve the app (eg: nginx) is serving the `dist` folder. It can run on any port, the ports just have to be reflected in the redirect URL in your configurations.

## Working with Client Secrets

Client secrets are not required as it depends on how you plan to deploy your app - if your application is sitting in a secured network (non-public facing), you may provide one in the app & definition. This is known as a **confidential** app. Otherwise, leave the secret blank. This is known as a **public** app. 

**If you're running the application locally**

To enable client secrets, uncomment the `window["env"]["clientSecret"]` line in `env.js`. Edit the default value (`secrettest`) to whatever you want to configure.

**If you're running the application in Docker**

To enable client secrets, add a client secret to the `CLIENT_SECRET` line of `.env` 

## Configuration Options

There's a few settings in the `.env` file (for Docker deployments) & `env.js` (for all other deployments) that can be adjusted to help tune the deployment to your environment:

| `env.js` file     | `.env` file | Setting Description |
| ----------- | ----------- | ----------- |
| `skipIssuerCheck`      | `SKIP_ISSUER_CHECK`       | This will disable the issuer validation logic in the OIDC library. Useful if your issuer URL has alternate casing, as the library by default will normalize the URL to all lowercase, which might cause issues with finding the auth server since technically that lowercase URL doesn't exist.       |
| `requireHttps`   | `ENABLE_HTTPS`        |  This will alter the behaviour of the OIDC library to enable HTTPS. Useful if you have a HTTPS connection setup for your environment.        |


## Working with FHIR Servers

While this application is designed to be as server agnostic as possible, you may need to tweak your server settings based on the FHIR server you use. If you don't see your server listed and would like to contribute to setup instructions, feel free to submit a pull request! The more the merrier :)

[Smile CDR](fhirserverinstructions/fhirservers-smile.md)

## Docker Deployment - Deploying Using Pre-built Images

If you plan on using the pre-built Docker images from [Docker Hub](https://hub.docker.com/r/omarhoblos/swiss-on-fhir), the process is fairly straight forward. Note that the Docker Hub version of Swiss has been designed to work on both `linux/arm64` and `linux/amd64` architectures - meaning it's compatible with x86 machines & Apple Silicon. In theory it should work on other ARM devices, such as the Raspberry Pi, but this has not been tested at the time of writing.

To get started:

1. Run `docker pull omarhoblos/swiss-on-fhir`
2. Create an `.env` file. You can use the one from [the repo](https://github.com/omarhoblos/swiss-on-fhir/blob/main/.env) as a template, and adjust values accordingly.
3. Run `docker run -d -p 4200:80 --env-file .env --name swiss_app_local omarhoblos/swiss-on-fhir` in the same directory you created your `.env` file to build a container using the Docker Hub image. 

Of course you can execute the `docker run` command outside the same directory, but will need to refer to its path in the command. Your command should look something like this: `docker run -d -p 4200:80 --env-file /path/to/your/.env --name swiss_app omarhoblos/swiss-on-fhir`

## Docker Deployment - Building From Source

If you want to build the application & image yourself, run the `docker-build.sh` script to deploy the application in a Docker container. The deployed app will be a compiled version of the Angular app being served by nginx running in the container.

The application will be labelled as **swiss_app**. An `.env` file is included in the root directory of the project. The application is designed so that on creating a container, the `.env` file is read and populates fields in the `env.template.js` file, which the application then reads for the necessary configurations & URLs. Therefore, any changes made in `.env` will show up in the application (after a refresh of the application in the browser). If you do end up changing the `.env` while the container is running, you'll need to stop the container, delete it, then create a new one (see command further down this section for how to do that).

Run the `docker-cleanup.sh` script to delete the container & image. Useful if you're debugging and want to start fresh. Otherwise, you can delete the container itself and run the following to create a new container: 

```dockerfile
docker run -d -p 4200:80 --env-file .env  --name swiss_app swiss
```

> If the scripts are not running on your local machine, make sure to make them executable by running `chmod +x docker-build.sh && chmod +x docker-cleanup.sh`

## Development server

Run `npm start` for a dev server. Navigate to `http://localhost:4200/`. The app will automatically reload if you change any of the source files. If you haven't installed the node modules for this local project, run `npm i` first.

## Changelog

View the [CHANGELOG](CHANGELOG.md) for updates to major versions of Swiss.

## Roadmap

The following features are planning to be added at a later time:

* Form for inputing user defined queries - [x]
* Cleaned up UI - Always a work in progress
* Add EHR Launch as an option []
* Add option to hot-swap environment variables in the app

## Shoutouts

A big thank you to everyone who's helped with this app, including:

* [Jana Mailvaganam](https://github.com/Jaymn)  - Application updates & contributions
* [Aditya Dave](https://github.com/AD1306) - Code review & architecture ideas
* Daniel Bach - Creating & validating test data
* Pechow Zheng - Creating & validating test data
* Steven Li - Testing & architecture ideas
* Taha Attari - Code review
* and the wonderful folk at [Smile CDR](https://www.smilecdr.com/our-team) 
