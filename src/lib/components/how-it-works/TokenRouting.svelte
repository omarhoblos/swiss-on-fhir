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

<svg
  class="dg block h-auto w-full min-w-[720px]"
  viewBox="0 0 940 230"
  role="img"
  aria-label="fhirRequest compares a request's origin with the FHIR base the session was issued for. Same origin: the Authorization header is attached. Another origin: the token is withheld unless you opt in for this page."
>
  <defs>
    <marker
      id="s7a"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="ha" d="M0 0 L10 5 L0 10 z" /></marker
    >
    <marker
      id="s7m"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="hm" d="M0 0 L10 5 L0 10 z" /></marker
    >
  </defs>

  <rect class="box-s" x="16" y="78" width="230" height="74" rx="6" />
  <text class="t ts" x="30" y="101">session</text>
  <text class="m" x="30" y="120">token issued for</text>
  <text class="cs" x="30" y="139">configSnapshot.fhirBaseUrl</text>

  <path class="ln" d="M246 115 H296" marker-end="url(#s7m)" />

  <rect class="box-a" x="300" y="78" width="250" height="74" rx="6" />
  <text class="c ta" x="425" y="105" text-anchor="middle">fhirRequest(url)</text>
  <text class="m" x="425" y="126" text-anchor="middle">same origin as that base?</text>

  <path class="la" d="M550 100 H580 V52 H626" marker-end="url(#s7a)" />
  <text class="m" x="596" y="44">yes</text>
  <path class="ln" d="M550 130 H580 V178 H626" marker-end="url(#s7m)" />
  <text class="m" x="596" y="196">no</text>

  <rect class="box-e" x="630" y="20" width="294" height="64" rx="6" />
  <text class="c" x="646" y="46">Authorization: Bearer …</text>
  <text class="m" x="646" y="66">attached</text>

  <rect class="box" x="630" y="146" width="294" height="64" rx="6" />
  <text class="t" x="646" y="172">withheld</text>
  <text class="m" x="646" y="192">unless you allow it for this page</text>
</svg>
