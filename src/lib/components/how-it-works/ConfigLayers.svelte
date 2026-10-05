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
  viewBox="0 0 940 278"
  role="img"
  aria-label="config.current merges four layers per field: baked defaults, the runtime file from .env, Config screen overrides in localStorage, and an EHR launch's iss, which is never saved. The client secret has its own storage slot."
>
  <defs>
    <marker
      id="s2a"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="ha" d="M0 0 L10 5 L0 10 z" /></marker
    >
    <marker
      id="s2m"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="hm" d="M0 0 L10 5 L0 10 z" /></marker
    >
  </defs>

  <path class="ln" d="M26 246 V34" marker-end="url(#s2m)" />
  <text class="m" transform="translate(16 140) rotate(-90)" text-anchor="middle"
    >higher layer wins, per field</text
  >

  <rect class="box" x="48" y="22" width="552" height="46" rx="6" />
  <text class="c" x="64" y="50">launch</text>
  <text x="190" y="50">the iss an EHR launch passes</text>
  <text class="m" x="440" y="50">never saved</text>

  <rect class="box" x="48" y="80" width="552" height="46" rx="6" />
  <text class="c" x="64" y="108">overrides</text>
  <text x="190" y="108">edits on the Config screen</text>
  <text class="cs ts" x="440" y="108">localStorage</text>

  <rect class="box" x="48" y="138" width="552" height="46" rx="6" />
  <text class="c" x="64" y="166">runtime</text>
  <text x="190" y="166">/swiss-env.json, from .env</text>
  <text class="m" x="440" y="166">fetched at page load</text>

  <rect class="box" x="48" y="196" width="552" height="46" rx="6" />
  <text class="c" x="64" y="224">DEFAULTS</text>
  <text x="190" y="224">baked into the build</text>
  <text class="m" x="440" y="224">src/lib/config/defaults.ts</text>

  <path class="ln" d="M600 45 H630 V219 H600 M600 103 H630 M600 161 H630" />
  <path class="la" d="M630 132 H676" marker-end="url(#s2a)" />
  <text class="m" x="653" y="124" text-anchor="middle">merge</text>

  <rect class="box-a" x="680" y="102" width="244" height="60" rx="6" />
  <text class="c ta" x="802" y="128" text-anchor="middle">config.current</text>
  <text class="m" x="802" y="148" text-anchor="middle">what every page reads</text>

  <rect class="box-s" x="680" y="190" width="244" height="62" rx="6" />
  <text class="t ts" x="694" y="212">client secret</text>
  <text class="m" x="694" y="230">own slot, sessionStorage by default</text>
  <text class="m" x="694" y="245">never copied into a launch</text>
</svg>
