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
  viewBox="0 0 940 456"
  role="img"
  aria-label="The container only serves the app and its configuration file. Everything else runs in the browser tab: pages read stores, stores call pure libraries, and every request goes through probe() to your authorization and FHIR servers."
>
  <defs>
    <marker
      id="s1a"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"><path class="ha" d="M0 0 L10 5 L0 10 z" /></marker
    >
    <marker
      id="s1m"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"><path class="hm" d="M0 0 L10 5 L0 10 z" /></marker
    >
  </defs>

  <!-- container -->
  <rect class="zone" x="16" y="40" width="200" height="236" rx="10" />
  <text class="t" x="30" y="64">Container · nginx</text>
  <rect class="box" x="32" y="80" width="168" height="50" rx="6" />
  <text class="c" x="46" y="101">build/</text>
  <text class="m" x="46" y="119">the compiled app</text>
  <rect class="box-s" x="32" y="142" width="168" height="50" rx="6" />
  <text class="c ts" x="46" y="163">/swiss-env.json</text>
  <text class="m" x="46" y="181">rendered from .env</text>
  <rect class="box" x="32" y="204" width="168" height="50" rx="6" />
  <text class="c" x="46" y="225">headers</text>
  <text class="m" x="46" y="243">frame-ancestors, nosniff</text>

  <path class="ln" d="M216 158 H258" marker-end="url(#s1m)" />
  <text class="m" x="237" y="140" text-anchor="middle">files,</text>
  <text class="m" x="237" y="152" text-anchor="middle">once</text>

  <!-- browser -->
  <rect class="zone" x="264" y="40" width="440" height="400" rx="10" />
  <text class="t" x="278" y="64">Your browser tab</text>

  <rect class="box" x="280" y="78" width="408" height="54" rx="6" />
  <text class="t" x="294" y="99">Pages</text>
  <text class="cs" x="294" y="119">/launch /callback / /fhir /diagnostics /config</text>
  <path class="ln" d="M484 132 V156" marker-end="url(#s1m)" />

  <text class="m" x="280" y="170">Stores: one shared object each</text>
  <rect class="box-a" x="280" y="178" width="96" height="48" rx="6" />
  <text class="c" x="328" y="199" text-anchor="middle">config</text>
  <text class="m" x="328" y="216" text-anchor="middle">settings</text>
  <rect class="box-a" x="384" y="178" width="96" height="48" rx="6" />
  <text class="c" x="432" y="199" text-anchor="middle">session</text>
  <text class="m" x="432" y="216" text-anchor="middle">tokens</text>
  <rect class="box-a" x="488" y="178" width="96" height="48" rx="6" />
  <text class="c" x="536" y="199" text-anchor="middle">diagnostics</text>
  <text class="m" x="536" y="216" text-anchor="middle">endpoints</text>
  <rect class="box-a" x="592" y="178" width="96" height="48" rx="6" />
  <text class="c" x="640" y="199" text-anchor="middle">exchangeLog</text>
  <text class="m" x="640" y="216" text-anchor="middle">requests</text>
  <path class="ln" d="M484 226 V250" marker-end="url(#s1m)" />

  <text class="m" x="280" y="264">Libraries: plain functions</text>
  <rect class="box" x="280" y="272" width="130" height="48" rx="6" />
  <text class="c" x="345" y="293" text-anchor="middle">smart/</text>
  <text class="m" x="345" y="310" text-anchor="middle">discovery, scopes</text>
  <rect class="box" x="419" y="272" width="130" height="48" rx="6" />
  <text class="c" x="484" y="293" text-anchor="middle">oidc/</text>
  <text class="m" x="484" y="310" text-anchor="middle">PKCE, tokens, JWTs</text>
  <rect class="box" x="558" y="272" width="130" height="48" rx="6" />
  <text class="c" x="623" y="293" text-anchor="middle">fhir/</text>
  <text class="m" x="623" y="310" text-anchor="middle">requests, URLs</text>
  <path class="ln" d="M484 320 V344" marker-end="url(#s1m)" />

  <rect class="box-a" x="280" y="350" width="408" height="38" rx="6" />
  <text class="c ta" x="300" y="374">probe()</text>
  <text class="m" x="364" y="374">every HTTP request goes through here</text>

  <rect class="box-s" x="280" y="398" width="408" height="30" rx="6" />
  <text class="m" x="484" y="418" text-anchor="middle"
    >Browser storage: sessionStorage · localStorage · IndexedDB</text
  >

  <!-- servers -->
  <rect class="zone" x="752" y="40" width="172" height="400" rx="10" />
  <text class="t" x="766" y="64">Your servers</text>
  <rect class="box-e" x="766" y="112" width="144" height="60" rx="6" />
  <text class="t te" x="838" y="138" text-anchor="middle">Authorization</text>
  <text class="t te" x="838" y="156" text-anchor="middle">server</text>
  <text class="m" x="838" y="190" text-anchor="middle">discovery, token</text>
  <rect class="box-e" x="766" y="300" width="144" height="60" rx="6" />
  <text class="t te" x="838" y="335" text-anchor="middle">FHIR server</text>
  <text class="m" x="838" y="378" text-anchor="middle">FHIR API, /metadata</text>

  <path class="la" d="M688 362 H718 V148 H762" marker-end="url(#s1a)" />
  <path class="la" d="M688 376 H734 V330 H762" marker-end="url(#s1a)" />
  <path
    class="ln dash"
    d="M688 98 H742 V128 H762"
    marker-start="url(#s1m)"
    marker-end="url(#s1m)"
  />
</svg>
