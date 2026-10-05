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
  viewBox="0 0 940 200"
  role="img"
  aria-label="Pushing a version tag runs the release workflow: a version check, the full CI suite, then the multi-arch image push to Docker Hub, followed by the GitHub release and a redeploy of the DigitalOcean app, which pulls the 3 tag."
>
  <defs>
    <marker
      id="s9a"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"><path class="ha" d="M0 0 L10 5 L0 10 z" /></marker
    >
  </defs>
  <rect class="box" x="16" y="66" width="140" height="56" rx="6" />
  <text class="c" x="86" y="90" text-anchor="middle">git tag v3.x.y</text>
  <text class="m" x="86" y="108" text-anchor="middle">npm version, push</text>
  <path class="la" d="M156 94 H182" marker-end="url(#s9a)" />

  <rect class="box" x="186" y="66" width="140" height="56" rx="6" />
  <text class="t" x="256" y="90" text-anchor="middle">Version check</text>
  <text class="m" x="256" y="108" text-anchor="middle">matches, on main</text>
  <path class="la" d="M326 94 H352" marker-end="url(#s9a)" />

  <rect class="box" x="356" y="66" width="150" height="56" rx="6" />
  <text class="t" x="431" y="90" text-anchor="middle">CI</text>
  <text class="m" x="431" y="108" text-anchor="middle">lint, tests, image</text>
  <path class="la" d="M506 94 H532" marker-end="url(#s9a)" />

  <rect class="box-a" x="536" y="66" width="150" height="56" rx="6" />
  <text class="t ta" x="611" y="90" text-anchor="middle">Publish image</text>
  <text class="m" x="611" y="108" text-anchor="middle">Docker Hub</text>

  <path class="la" d="M686 84 H706 V48 H726" marker-end="url(#s9a)" />
  <path class="la" d="M686 104 H706 V144 H726" marker-end="url(#s9a)" />

  <rect class="box" x="730" y="20" width="194" height="56" rx="6" />
  <text class="t" x="827" y="44" text-anchor="middle">GitHub release</text>
  <text class="m" x="827" y="62" text-anchor="middle">generated notes</text>
  <rect class="box-e" x="730" y="116" width="194" height="56" rx="6" />
  <text class="t te" x="827" y="140" text-anchor="middle">Redeploy app</text>
  <text class="m" x="827" y="158" text-anchor="middle">DigitalOcean pulls :3</text>
</svg>
