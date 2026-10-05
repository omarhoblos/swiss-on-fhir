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
  viewBox="0 0 940 640"
  role="img"
  aria-label="Sequence of a sign-in: discover endpoints, save a transaction with the PKCE verifier, state and nonce, redirect to the authorization server, return to /callback, match the state, exchange the code with the verifier, check the ID token and iss without blocking, then establish the session."
>
  <defs>
    <marker
      id="s4a"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="ha" d="M0 0 L10 5 L0 10 z" /></marker
    >
    <marker
      id="s4m"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="hm" d="M0 0 L10 5 L0 10 z" /></marker
    >
    <marker
      id="s4s"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="hs" d="M0 0 L10 5 L0 10 z" /></marker
    >
  </defs>

  <!-- lane heads -->
  <rect class="box-a" x="40" y="14" width="220" height="40" rx="6" />
  <text class="t ta" x="150" y="39" text-anchor="middle">Swiss · auth/flow.ts</text>
  <rect class="box-s" x="330" y="14" width="160" height="40" rx="6" />
  <text class="t ts" x="410" y="39" text-anchor="middle">sessionStorage</text>
  <rect class="box-e" x="550" y="14" width="180" height="40" rx="6" />
  <text class="t te" x="640" y="39" text-anchor="middle">Authorization server</text>
  <rect class="box-e" x="760" y="14" width="164" height="40" rx="6" />
  <text class="t te" x="842" y="39" text-anchor="middle">FHIR server</text>

  <line class="life" x1="150" y1="54" x2="150" y2="626" />
  <line class="life" x1="410" y1="54" x2="410" y2="626" />
  <line class="life" x1="640" y1="54" x2="640" y2="626" />
  <line class="life" x1="842" y1="54" x2="842" y2="626" />

  <!-- 1 discovery -->
  <circle class="step" cx="22" cy="92" r="10" /><text
    class="stepn"
    x="22"
    y="96"
    text-anchor="middle">1</text
  >
  <text class="cs" x="160" y="86">GET smart-configuration, /metadata</text>
  <path class="la" d="M150 94 H836" marker-end="url(#s4a)" />
  <text class="cs" x="160" y="120">GET openid-configuration</text>
  <path class="la" d="M150 128 H634" marker-end="url(#s4a)" />
  <rect class="box" x="40" y="142" width="220" height="32" rx="6" />
  <text class="m" x="150" y="163" text-anchor="middle">merge into endpoints</text>

  <!-- 2 save transaction -->
  <circle class="step" cx="22" cy="212" r="10" /><text
    class="stepn"
    x="22"
    y="216"
    text-anchor="middle">2</text
  >
  <text class="cs" x="160" y="206">save verifier, state, nonce, snapshot</text>
  <path class="ls" d="M150 214 H404" marker-end="url(#s4s)" />
  <text class="cs" x="160" y="231">state and nonce: 16 random bytes each</text>

  <!-- 3 redirect -->
  <circle class="step" cx="22" cy="258" r="10" /><text
    class="stepn"
    x="22"
    y="262"
    text-anchor="middle">3</text
  >
  <text class="cs" x="160" y="252">navigate to /authorize: S256 challenge, state, nonce, aud</text>
  <path class="ln dash" d="M150 260 H634" marker-end="url(#s4m)" />
  <rect class="box-e" x="568" y="276" width="144" height="32" rx="6" />
  <text class="m" x="640" y="297" text-anchor="middle">you sign in</text>

  <!-- 4 callback -->
  <circle class="step" cx="22" cy="340" r="10" /><text
    class="stepn"
    x="22"
    y="344"
    text-anchor="middle">4</text
  >
  <text class="cs" x="630" y="334" text-anchor="end">302 to /callback?code, state, iss</text>
  <path class="ln dash" d="M640 342 H156" marker-end="url(#s4m)" />

  <!-- 5 match -->
  <circle class="step" cx="22" cy="386" r="10" /><text
    class="stepn"
    x="22"
    y="390"
    text-anchor="middle">5</text
  >
  <text class="cs" x="160" y="380">find the launch by state, mark it "exchanging"</text>
  <path class="ls" d="M150 388 H404" marker-end="url(#s4s)" />

  <!-- 6 exchange -->
  <circle class="step" cx="22" cy="432" r="10" /><text
    class="stepn"
    x="22"
    y="436"
    text-anchor="middle">6</text
  >
  <text class="cs" x="160" y="426">POST /token: code + code_verifier</text>
  <path class="la" d="M150 434 H634" marker-end="url(#s4a)" />
  <text class="cs" x="630" y="460" text-anchor="end">access, ID and refresh tokens</text>
  <path class="la" d="M640 468 H156" marker-end="url(#s4a)" />

  <!-- 7 checks -->
  <circle class="step" cx="22" cy="508" r="10" /><text
    class="stepn"
    x="22"
    y="512"
    text-anchor="middle">7</text
  >
  <rect class="box-a" x="40" y="492" width="250" height="80" rx="6" />
  <text class="t" x="54" y="513">Checks, reported not enforced</text>
  <text class="m" x="54" y="531">iss on the redirect (RFC 9207)</text>
  <text class="m" x="54" y="547">ID token: signature, iss, aud, exp, nonce</text>
  <text class="m" x="54" y="563">iat and sub present, asymmetric algs only</text>
  <text class="cs" x="300" y="518">GET jwks_uri</text>
  <path class="la" d="M290 526 H634" marker-end="url(#s4a)" />

  <!-- 8 establish -->
  <circle class="step" cx="22" cy="600" r="10" /><text
    class="stepn"
    x="22"
    y="604"
    text-anchor="middle">8</text
  >
  <text class="cs" x="160" y="594">store the session, open the Session page</text>
  <path class="ls" d="M150 602 H404" marker-end="url(#s4s)" />
</svg>
