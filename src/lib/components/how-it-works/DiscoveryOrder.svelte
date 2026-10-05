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
  viewBox="0 0 940 170"
  role="img"
  aria-label="Endpoints come from three documents in order of trust: smart-configuration, openid-configuration, then the CapabilityStatement. The highest source with a value wins per endpoint; conflicts and non-http values are reported."
>
  <defs>
    <marker
      id="s3a"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="ha" d="M0 0 L10 5 L0 10 z" /></marker
    >
  </defs>
  <rect class="box" x="16" y="16" width="520" height="38" rx="6" />
  <circle class="step" cx="38" cy="35" r="10" /><text
    class="stepn"
    x="38"
    y="39"
    text-anchor="middle">1</text
  >
  <text class="c" x="60" y="40">smart-configuration</text>
  <text class="cs" x="236" y="40">&#123;FHIR base&#125;/.well-known/smart-configuration</text>

  <rect class="box" x="16" y="62" width="520" height="38" rx="6" />
  <circle class="step" cx="38" cy="81" r="10" /><text
    class="stepn"
    x="38"
    y="85"
    text-anchor="middle">2</text
  >
  <text class="c" x="60" y="86">openid-configuration</text>
  <text class="cs" x="236" y="86">&#123;issuer&#125;/.well-known/openid-configuration</text>

  <rect class="box" x="16" y="108" width="520" height="38" rx="6" />
  <circle class="step" cx="38" cy="127" r="10" /><text
    class="stepn"
    x="38"
    y="131"
    text-anchor="middle">3</text
  >
  <text class="c" x="60" y="132">capability-statement</text>
  <text class="cs" x="236" y="132">&#123;FHIR base&#125;/metadata, SMART 1.0 extension</text>

  <path class="ln" d="M536 35 H566 V127 H536 M536 81 H566" />
  <path class="la" d="M566 58 H616" marker-end="url(#s3a)" />
  <text class="m" x="591" y="50" text-anchor="middle">per key</text>

  <rect class="box-a" x="620" y="12" width="304" height="62" rx="6" />
  <text class="c ta" x="772" y="37" text-anchor="middle">diagnostics.endpoints</text>
  <text class="m" x="772" y="57" text-anchor="middle">the highest source with a value wins</text>

  <rect class="box" x="620" y="86" width="304" height="72" rx="6" />
  <text class="t" x="634" y="108">Kept as findings</text>
  <text class="m" x="634" y="127">disagreements: "Discovery documents agree"</text>
  <text class="m" x="634" y="144">non-http(s) values are dropped, never used</text>
</svg>
