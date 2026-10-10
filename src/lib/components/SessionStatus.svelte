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
  import { session } from '$lib/auth/session.svelte';
  import { formatCountdown } from '$lib/time';

  /**
   * Whether there is a session, in the bar that is on every page, linking to
   * the Session page. Expired is its own state, since a token past its
   * lifetime is still held and still shown there, ready to refresh. A
   * lifetime the server never stated is not counted as expired.
   */
  const expired = $derived(session.isExpired);
  const remaining = $derived(session.secondsRemaining);
</script>

{#if session.isAuthenticated}
  <a
    href="/"
    title={expired
      ? 'The access token has passed its lifetime. Open the Session page to refresh it.'
      : remaining !== null
        ? `Expires in ${formatCountdown(remaining)}`
        : 'Open the Session page'}
    class="flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap hover:underline
      {expired ? 'border-error text-error' : 'border-success text-success'}"
  >
    <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>
    {expired ? 'Session expired' : 'Active session'}
  </a>
{/if}
