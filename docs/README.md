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

# Swiss on FHIR developer documentation

These pages are for people who want to read, change or extend Swiss's source code. If you want to use Swiss, start with the project [README](../README.md) instead: it covers running Swiss, configuring it and registering it with your servers.

| Page | Read it to |
| --- | --- |
| [Architecture](architecture.md) | Understand how the parts fit together: configuration, discovery, the sign-in, the request log, where the token goes, Diagnostics, and how a release ships. One diagram per mechanism. |
| [Developing Swiss](developing.md) | Set up, find your way around `src/`, run and write tests, make the most common kinds of change, and release. |

Swiss itself has an illustrated version of the architecture: open **How Swiss works** from the footer of any page, or go to `/how-it-works`. Its diagrams live in `src/lib/components/how-it-works/`.

Server-specific setup notes live with the other [FHIR server instructions](../fhirserverinstructions/smilecdr/fhirservers-smile.md), not here.

## Three rules that shape the code

Everything in these pages follows from three decisions. Keep them in mind when you change anything.

- **Report, don't refuse.** A wrong nonce, an unverifiable ID token or a mismatched issuer becomes a finding shown next to the token. Swiss never blocks a sign-in over it, because that finding is what the tool is for.
- **Advertise, don't block.** Servers under-report what they support. A capability missing from a discovery document only produces a warning; only an explicit contradiction disables a control, and even then behind an override.
- **Show every request.** Swiss builds the authorization URL itself so it can be previewed, and every HTTP request goes through one function, `probe()`, whose record ends up in the exchange log.

The one deliberate exception: a bad deployment input, such as a control character in the container's `.env`, stops the container. That is an operator error, not a server under test, so it is refused rather than repaired.
