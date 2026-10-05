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
  viewBox="0 0 940 286"
  role="img"
  aria-label="Five callers send requests through probe(), which talks to your servers and returns an HttpExchange that the caller records. The exchange log keeps the newest 200 and feeds the drawer view, an IndexedDB copy that is always redacted, and downloads."
>
  <defs>
    <marker
      id="s6a"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"><path class="ha" d="M0 0 L10 5 L0 10 z" /></marker
    >
    <marker
      id="s6m"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="hm" d="M0 0 L10 5 L0 10 z" /></marker
    >
    <marker
      id="s6e"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"><path class="he" d="M0 0 L10 5 L0 10 z" /></marker
    >
  </defs>

  <rect class="box" x="16" y="70" width="180" height="32" rx="6" /><text class="c" x="30" y="91"
    >auth/flow.ts</text
  >
  <rect class="box" x="16" y="110" width="180" height="32" rx="6" /><text class="c" x="30" y="131"
    >session store</text
  >
  <rect class="box" x="16" y="150" width="180" height="32" rx="6" /><text class="c" x="30" y="171"
    >diagnostics store</text
  >
  <rect class="box" x="16" y="190" width="180" height="32" rx="6" /><text class="c" x="30" y="211"
    >fhir/client</text
  >
  <rect class="box" x="16" y="230" width="180" height="32" rx="6" /><text class="c" x="30" y="251"
    >BackendServices</text
  >

  <path class="ln" d="M196 86 H222 V246 H196 M196 126 H222 M196 166 H222 M196 206 H222" />
  <path class="la" d="M222 166 H246" marker-end="url(#s6a)" />

  <rect class="box-e" x="250" y="14" width="180" height="40" rx="6" />
  <text class="t te" x="340" y="39" text-anchor="middle">Your servers</text>
  <path class="le" d="M340 132 V58" marker-start="url(#s6e)" marker-end="url(#s6e)" />

  <rect class="box-a" x="250" y="136" width="180" height="60" rx="6" />
  <text class="c ta" x="340" y="161" text-anchor="middle">probe()</text>
  <text class="m" x="340" y="180" text-anchor="middle">fetch, then classify</text>

  <path class="la" d="M430 166 H476" marker-end="url(#s6a)" />
  <rect class="box" x="480" y="136" width="200" height="60" rx="6" />
  <text class="c" x="580" y="161" text-anchor="middle">HttpExchange</text>
  <text class="m" x="580" y="180" text-anchor="middle">request, response, outcome</text>

  <path class="la" d="M680 166 H726" marker-end="url(#s6a)" />
  <text class="m" x="705" y="184" text-anchor="middle">caller</text>
  <text class="m" x="705" y="197" text-anchor="middle">records</text>
  <rect class="box-a" x="730" y="136" width="194" height="60" rx="6" />
  <text class="c ta" x="827" y="161" text-anchor="middle">exchangeLog</text>
  <text class="m" x="827" y="180" text-anchor="middle">newest 200, in memory</text>

  <path class="ln" d="M827 196 V214 H555 V226 M712 214 V226 M859 214 V226 M827 214 H859" />
  <rect class="box" x="480" y="230" width="150" height="48" rx="6" />
  <text class="t" x="555" y="250" text-anchor="middle">Drawer</text>
  <text class="m" x="555" y="267" text-anchor="middle">search, status chips</text>
  <rect class="box-s" x="638" y="230" width="148" height="48" rx="6" />
  <text class="c ts" x="712" y="250" text-anchor="middle">IndexedDB</text>
  <text class="m" x="712" y="267" text-anchor="middle">always redacted</text>
  <rect class="box" x="794" y="230" width="130" height="48" rx="6" />
  <text class="t" x="859" y="250" text-anchor="middle">Downloads</text>
  <text class="m" x="859" y="267" text-anchor="middle">redacted by default</text>

  <text class="m" x="480" y="92">outcome is one of: ok · http-error ·</text>
  <text class="m" x="480" y="108">network-or-cors · timeout · invalid-json ·</text>
  <text class="m" x="480" y="124">bad-content-type · blocked · aborted</text>
</svg>
