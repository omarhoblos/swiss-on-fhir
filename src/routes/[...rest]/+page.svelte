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
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  /**
   * Catch-all, replacing Angular's `{ path: '**', redirectTo: '' }`.
   *
   * It exists mainly for redirect-URI compatibility. Existing Swiss client
   * definitions are registered against three different landing shapes:
   *
   *   /            - a real route (the value the Angular code actually used)
   *   /callback    - a real route (the new default)
   *   /index.html  - nginx serves the file, then the router finds no route
   *                  and lands here
   *
   * So if the URL carries OAuth parameters, hand off to the callback handler
   * instead of bouncing the user to the home page and losing the code.
   */
  const hasOauthParams = $derived(
    ['code', 'state', 'error'].some((k) => page.url.searchParams.has(k))
  );

  onMount(() => {
    if (hasOauthParams) {
      // Preserve the query string so the callback route can consume it.
      void goto(`/callback${page.url.search}`, { replaceState: true });
    } else {
      void goto('/', { replaceState: true });
    }
  });
</script>

<p class="text-fg-muted text-sm">Redirecting…</p>
