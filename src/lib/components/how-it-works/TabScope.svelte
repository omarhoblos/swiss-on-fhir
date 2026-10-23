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
  class="dg block h-auto w-full min-w-180"
  viewBox="0 0 940 300"
  role="img"
  aria-label="What stays in one browser tab and what all tabs share. Each tab keeps its environment, its session slot, launches in flight, Diagnostics results, an EHR launch's iss, and its id and label. All tabs share the environments and their settings, Backend Services keys, the exchange log tagged by tab, saved FHIR headers, and sessions when token storage is local. Tabs keep the shared parts in step with storage events, a BroadcastChannel and Web Locks."
>
  <defs>
    <marker
      id="s9m"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="hm" d="M0 0 L10 5 L0 10 z" /></marker
    >
  </defs>

  <rect class="zone" x="16" y="16" width="360" height="268" rx="10" />
  <text class="t" x="32" y="42">Each tab, on its own</text>
  <text class="m" x="32" y="60">sessionStorage and memory</text>

  <rect class="box-a" x="32" y="74" width="328" height="34" rx="6" />
  <text class="c ta" x="46" y="96">environment in use</text>
  <rect class="box-a" x="32" y="114" width="328" height="34" rx="6" />
  <text class="c ta" x="46" y="136">session slot shown · launches in flight</text>
  <rect class="box-a" x="32" y="154" width="328" height="34" rx="6" />
  <text class="c ta" x="46" y="176">Diagnostics results · EHR launch iss</text>
  <rect class="box-a" x="32" y="194" width="328" height="34" rx="6" />
  <text class="c ta" x="46" y="216">tab id and label</text>
  <rect class="box" x="32" y="234" width="328" height="34" rx="6" />
  <text class="t" x="46" y="256">sessions, when token storage is session or memory</text>

  <path class="ln" d="M380 150 H556" marker-end="url(#s9m)" />
  <path class="ln" d="M556 166 H380" marker-end="url(#s9m)" />
  <text class="m" x="468" y="128" text-anchor="middle">storage events</text>
  <text class="m" x="468" y="190" text-anchor="middle">BroadcastChannel</text>
  <text class="m" x="468" y="206" text-anchor="middle">Web Locks</text>

  <rect class="zone" x="564" y="16" width="360" height="268" rx="10" />
  <text class="t" x="580" y="42">Shared by every tab</text>
  <text class="m" x="580" y="60">localStorage and IndexedDB</text>

  <rect class="box-s" x="580" y="74" width="328" height="34" rx="6" />
  <text class="c ts" x="594" y="96">environments and their settings</text>
  <rect class="box-s" x="580" y="114" width="328" height="34" rx="6" />
  <text class="c ts" x="594" y="136">Backend Services keys, one per environment</text>
  <rect class="box-s" x="580" y="154" width="328" height="34" rx="6" />
  <text class="c ts" x="594" y="176">exchange log, each entry tagged by tab</text>
  <rect class="box-s" x="580" y="194" width="328" height="34" rx="6" />
  <text class="c ts" x="594" y="216">saved FHIR headers, per environment</text>
  <rect class="box" x="580" y="234" width="328" height="34" rx="6" />
  <text class="t" x="594" y="256">sessions, when token storage is local</text>
</svg>
