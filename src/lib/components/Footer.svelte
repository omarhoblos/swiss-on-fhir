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

<script lang="ts">
  // Version comes from kit.version.name in svelte.config.js, which reads
  // package.json at build time. Replaces the old deep relative import of
  // package.json (and the resolveJsonModule flag it required).
  import { version } from '$app/environment';
  import Heart from '$lib/icons/Heart.svelte';
  import Github from '$lib/icons/Github.svelte';
  import Linkedin from '$lib/icons/Linkedin.svelte';
</script>

<footer class="border-border text-fg-muted mt-16 border-t py-10 text-center text-sm">
  <p class="flex items-center justify-center gap-1.5">
    <span>Made with</span>
    <Heart class="text-error h-4 w-4" />
    <span>by Omar Hoblos</span>
  </p>
  <div class="mt-3 flex items-center justify-center gap-4">
    <a
      href="https://github.com/omarhoblos"
      target="_blank"
      rel="noopener noreferrer"
      class="hover:text-fg transition-colors"
      aria-label="GitHub"
    >
      <Github />
    </a>
    <a
      href="https://www.linkedin.com/in/omar-hoblos-5a7aa653/"
      target="_blank"
      rel="noopener noreferrer"
      class="hover:text-fg transition-colors"
      aria-label="LinkedIn"
    >
      <Linkedin />
    </a>
  </div>
  <p class="mt-3 font-mono text-xs">Version {version}</p>
</footer>
