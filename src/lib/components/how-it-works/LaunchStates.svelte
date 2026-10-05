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
  viewBox="0 0 940 224"
  role="img"
  aria-label="A launch transaction starts pending, becomes exchanging when the callback matches its state, then consumed on success or failed on an error. A reloaded callback for a consumed or exchanging launch is refused locally."
>
  <defs>
    <marker
      id="s5a"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="ha" d="M0 0 L10 5 L0 10 z" /></marker
    >
    <marker
      id="s5m"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="hm" d="M0 0 L10 5 L0 10 z" /></marker
    >
  </defs>

  <rect class="box-s" x="20" y="70" width="150" height="46" rx="23" />
  <text class="c" x="95" y="98" text-anchor="middle">pending</text>
  <text class="m" x="95" y="136" text-anchor="middle">saved at launch</text>

  <path class="la" d="M170 93 H286" marker-end="url(#s5a)" />
  <text class="m" x="228" y="84" text-anchor="middle">state matched</text>

  <rect class="box-s" x="290" y="70" width="150" height="46" rx="23" />
  <text class="c" x="365" y="98" text-anchor="middle">exchanging</text>
  <text class="m" x="365" y="136" text-anchor="middle">over 10 minutes old: a</text>
  <text class="m" x="365" y="151" text-anchor="middle">warning, still tried</text>

  <path class="la" d="M440 85 L556 52" marker-end="url(#s5a)" />
  <text class="m" x="490" y="56" text-anchor="middle">tokens</text>
  <path class="ln" d="M440 101 L556 136" marker-end="url(#s5m)" />
  <text class="m" x="490" y="138" text-anchor="middle">token error</text>

  <rect class="box-s" x="560" y="26" width="150" height="46" rx="23" />
  <text class="c" x="635" y="54" text-anchor="middle">consumed</text>
  <rect class="box-s" x="560" y="120" width="150" height="46" rx="23" />
  <text class="c" x="635" y="148" text-anchor="middle">failed</text>

  <path class="ln" d="M95 116 V196 H635 V170" marker-end="url(#s5m)" />
  <text class="m" x="300" y="190">?error= with a matching state</text>

  <path class="ln dash" d="M710 49 H760" />
  <rect class="box" x="764" y="20" width="160" height="96" rx="6" />
  <text class="t" x="778" y="43">Callback reloaded</text>
  <text class="m" x="778" y="62">consumed or exchanging:</text>
  <text class="m" x="778" y="78">refused before any</text>
  <text class="m" x="778" y="94">request, with an</text>
  <text class="m" x="778" y="110">explanation</text>
</svg>
