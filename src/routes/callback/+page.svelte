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
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { completeCallback, type CallbackOutcome } from '$lib/auth/flow';
  import Alert from '$lib/components/ui/Alert.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import UrlLink from '$lib/components/UrlLink.svelte';

  let outcome = $state<CallbackOutcome | null>(null);
  let working = $state(true);

  onMount(() => {
    // Capture the parameters and strip them from the URL SYNCHRONOUSLY,
    // before the first await. An authorization code is single-use, so if the
    // user reloads this page with the code still in the URL, the second
    // exchange fails with invalid_grant -- which reads as a server fault and
    // almost nobody diagnoses correctly.
    const url = new URL(location.href);
    const hadParams = url.search.length > 1 || url.hash.length > 1;
    if (hadParams) {
      history.replaceState({}, '', `${location.pathname}`);
    }

    void (async () => {
      try {
        outcome = await completeCallback(url);
        if (outcome.kind === 'success') {
          // Land on the token inspector, which is the point of getting here.
          setTimeout(() => void goto('/', { replaceState: true }), 600);
        }
      } finally {
        working = false;
      }
    })();
  });

  const OAUTH_EXPLANATIONS: Record<string, string> = {
    access_denied:
      'The user or the server declined the request. Most often this is a cancelled consent screen.',
    invalid_scope:
      'The server rejected one or more requested scopes. Check the scope list on the Configuration page against what the server advertises.',
    invalid_request:
      'The server considered the authorization request malformed. If the description mentions `aud`, try the aud variants under Testing options.',
    invalid_client:
      'The server did not accept the client credentials. Check the client ID, and the secret if you are using a confidential client.',
    unauthorized_client:
      'The client exists but is not permitted to use this grant type. Check that the authorization code flow is enabled for it.',
    unsupported_response_type:
      'The server does not accept `response_type=code` for this client. Check that the authorization code flow is enabled.',
    server_error:
      'The server reported an internal error. Its own logs will say more than Swiss can.'
  };
</script>

<div class="mx-auto max-w-2xl space-y-4">
  {#if working}
    <h1 class="text-2xl font-semibold">Completing sign-in&hellip;</h1>
    <p class="text-fg-muted text-sm">Exchanging the authorization code for tokens.</p>
  {:else if outcome?.kind === 'success'}
    <h1 class="text-2xl font-semibold">Signed in</h1>
    {#each outcome.warnings as warning (warning)}
      <Alert severity="warning">{warning}</Alert>
    {/each}
    <p class="text-fg-muted text-sm">Taking you to the token inspector&hellip;</p>
    <a href="/" class="text-primary text-sm hover:underline">Go now</a>
  {:else if outcome?.kind === 'oauth-error'}
    <h1 class="text-2xl font-semibold">The server refused the authorization</h1>
    <Alert severity="error" title={outcome.error.error}>
      {#if outcome.error.error_description}
        <p>{outcome.error.error_description}</p>
      {/if}
      {#if OAUTH_EXPLANATIONS[outcome.error.error]}
        <p class="mt-2">{OAUTH_EXPLANATIONS[outcome.error.error]}</p>
      {/if}
      {#if outcome.error.error_uri}
        <!-- UrlLink links only http(s); anything else is shown as text. -->
        <p class="mt-2">
          More detail from the server: <UrlLink value={outcome.error.error_uri} class="underline" />
        </p>
      {/if}
    </Alert>
    {#if !outcome.matched}
      <Alert severity="warning" title="This error did not come from a launch this tab started">
        <p>
          Its <code class="font-mono text-xs">state</code> matches no pending authorization here, so it
          may be a stale link, a callback from another tab, or simply a URL someone sent you. It has not
          been recorded against your session.
        </p>
      </Alert>
    {/if}
    {#if outcome.deliveredIn === 'fragment'}
      <Alert severity="info" title="Non-conformant error delivery">
        <p>
          The error arrived in the URL fragment. For an authorization code flow, OAuth 2.0 requires
          it in the query string. Swiss reads both, but a stricter client would miss this entirely.
        </p>
      </Alert>
    {/if}
    <a href="/launch" class="text-primary text-sm hover:underline">Back to Launch</a>
  {:else if outcome?.kind === 'token-error'}
    <h1 class="text-2xl font-semibold">The token exchange failed</h1>
    <Alert severity="error" title={outcome.error.error}>
      {#if outcome.error.error_description}
        <p>{outcome.error.error_description}</p>
      {/if}
    </Alert>
    <Card title="What to check">
      <ul class="text-fg-muted list-inside list-disc space-y-1 text-sm">
        <li>
          <code class="font-mono text-xs">invalid_grant</code> usually means the code expired, was
          already used, or the <code class="font-mono text-xs">redirect_uri</code> did not match the authorization
          request byte for byte.
        </li>
        <li>
          <code class="font-mono text-xs">invalid_client</code> means the client ID or secret was rejected.
          Try a different client authentication method under Testing options.
        </li>
        <li>
          If the request never reached the server, open the exchange log at the bottom of the
          screen: it has the raw attempt, a curl command to reproduce it, and a downloadable copy.
        </li>
      </ul>
    </Card>
    <div class="flex gap-4">
      <a href="/diagnostics" class="text-primary text-sm hover:underline">Run diagnostics</a>
      <a href="/launch" class="text-primary text-sm hover:underline">Back to Launch</a>
    </div>
  {:else if outcome?.kind === 'validation-error'}
    <h1 class="text-2xl font-semibold">This callback could not be processed</h1>
    <Alert severity="error" title={outcome.code.replace(/-/g, ' ')}>
      <p>{outcome.message}</p>
    </Alert>
    <a href="/launch" class="text-primary text-sm hover:underline">Start a new launch</a>
  {:else}
    <h1 class="text-2xl font-semibold">Nothing to complete</h1>
    <p class="text-fg-muted text-sm">
      This page handles the redirect back from your authorization server, but the URL carried no
      authorization response.
    </p>
    <a href="/launch" class="text-primary text-sm hover:underline">Go to Launch</a>
  {/if}
</div>
