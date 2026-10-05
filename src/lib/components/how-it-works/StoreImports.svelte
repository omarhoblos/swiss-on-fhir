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
  viewBox="0 0 940 322"
  role="img"
  aria-label="Pages import the sign-in orchestrator, the stores and the FHIR client. The four stores form a chain: diagnostics imports session, which imports exchangeLog, which imports config. Plain libraries import no stores; fhir/client.ts is the one module that records into the exchange log."
>
  <defs>
    <marker
      id="s0m"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="hm" d="M0 0 L10 5 L0 10 z" /></marker
    >
    <marker
      id="s0a"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="ha" d="M0 0 L10 5 L0 10 z" /></marker
    >
  </defs>

  <rect class="box" x="300" y="16" width="340" height="48" rx="6" />
  <text class="t" x="470" y="37" text-anchor="middle">Pages and components</text>
  <text class="cs" x="470" y="55" text-anchor="middle">src/routes · lib/components</text>

  <rect class="box" x="196" y="104" width="200" height="48" rx="6" />
  <text class="c" x="296" y="125" text-anchor="middle">auth/flow.ts</text>
  <text class="m" x="296" y="142" text-anchor="middle">sign-in orchestration</text>

  <rect class="box" x="544" y="104" width="200" height="48" rx="6" />
  <text class="c" x="644" y="125" text-anchor="middle">fhir/client.ts</text>
  <text class="m" x="644" y="142" text-anchor="middle">FHIR console requests</text>

  <rect class="zone" x="16" y="196" width="580" height="110" rx="10" />
  <text class="m" x="30" y="216">Stores: each imports only the ones to its right</text>
  <rect class="box-a" x="32" y="230" width="118" height="52" rx="6" />
  <text class="c ta" x="91" y="252" text-anchor="middle">diagnostics</text>
  <text class="m" x="91" y="270" text-anchor="middle">endpoints, results</text>
  <rect class="box-a" x="172" y="230" width="118" height="52" rx="6" />
  <text class="c ta" x="231" y="252" text-anchor="middle">session</text>
  <text class="m" x="231" y="270" text-anchor="middle">tokens, context</text>
  <rect class="box-a" x="312" y="230" width="118" height="52" rx="6" />
  <text class="c ta" x="371" y="252" text-anchor="middle">exchangeLog</text>
  <text class="m" x="371" y="270" text-anchor="middle">recorded requests</text>
  <rect class="box-a" x="452" y="230" width="118" height="52" rx="6" />
  <text class="c ta" x="511" y="252" text-anchor="middle">config</text>
  <text class="m" x="511" y="270" text-anchor="middle">settings</text>
  <path class="la" d="M150 256 H168" marker-end="url(#s0a)" />
  <path class="la" d="M290 256 H308" marker-end="url(#s0a)" />
  <path class="la" d="M430 256 H448" marker-end="url(#s0a)" />

  <rect class="box" x="640" y="222" width="284" height="68" rx="6" />
  <text class="t" x="654" y="244">Plain libraries</text>
  <text class="m" x="654" y="262">no store imports, unit-testable</text>
  <text class="cs" x="654" y="279">oidc/ smart/ http/ config/* checks/</text>

  <path class="ln" d="M440 64 V82 H296 V100" marker-end="url(#s0m)" />
  <path class="ln" d="M500 64 V82 H644 V100" marker-end="url(#s0m)" />
  <path class="ln" d="M300 40 H60 V192" marker-end="url(#s0m)" />
  <path class="ln" d="M260 152 V192" marker-end="url(#s0m)" />
  <path class="ln" d="M340 152 V172 H690 V218" marker-end="url(#s0m)" />
  <path class="ln" d="M570 152 V184 H371 V226" marker-end="url(#s0m)" />
  <text class="m" x="380" y="214">records requests</text>
  <path class="ln" d="M720 152 V218" marker-end="url(#s0m)" />
  <path class="ln" d="M596 256 H636" marker-end="url(#s0m)" />
</svg>
