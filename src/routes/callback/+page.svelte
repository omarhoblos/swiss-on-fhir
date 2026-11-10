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
  import { completeCallback, type CallbackOutcome } from '#lib/auth/flow.ts';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Card from '#lib/components/ui/Card.svelte';
  import UrlLink from '#lib/components/UrlLink.svelte';

  let outcome = $state<CallbackOutcome | null>(null);
  let working = $state(true);
  /**
   * Something the callback did not expect threw. Shown, never swallowed: a
   * swallowed error left this page saying the URL "carried no authorization
   * response" after a code had in fact been exchanged.
   */
  let failure = $state<string | null>(null);

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
          setTimeout(() => void goto('/', { replace: true }), 600);
        }
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : String(cause);
      } finally {
        working = false;
      }
    })();
  });

  const OAUTH_EXPLANATIONS: Record<string, string> = {
    access_denied:
      'The user or the server declined the request, often by cancelling the consent screen.',
    invalid_scope:
      'The server rejected one or more scopes. Compare the scopes on Config with what the server advertises.',
    invalid_request:
      'The server found the request malformed. If the description mentions aud, try the aud variants under Testing options.',
    invalid_client:
      'The server rejected the client credentials. Check the client ID, and the secret for a confidential client.',
    unauthorized_client:
      'The client may not use this grant type. Check that the authorization code flow is enabled for it.',
    unsupported_response_type:
      'The server does not accept response_type=code for this client. Check that the authorization code flow is enabled.',
    server_error: 'The server reported an internal error. Check its logs.'
  };
  // Own properties only: `?error=constructor` would otherwise print a function.
  const explain = (code: string) =>
    Object.prototype.hasOwnProperty.call(OAUTH_EXPLANATIONS, code)
      ? OAUTH_EXPLANATIONS[code]
      : undefined;
</script>

<div class="mx-auto max-w-2xl space-y-4">
  {#if working}
    <h1 class="text-2xl font-semibold">Completing sign-in&hellip;</h1>
    <p class="text-fg-muted text-sm">Exchanging the authorization code for tokens.</p>
  {:else if outcome?.kind === 'success'}
    <h1 class="text-2xl font-semibold">Signed in</h1>
    {#each outcome.warnings as warning, i (i)}
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
      {#if explain(outcome.error.error)}
        <p class="mt-2">{explain(outcome.error.error)}</p>
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
          Its <code class="font-mono text-xs">state</code> matches no pending authorization in this tab,
          so it may be a stale link or come from another tab. It was not recorded against your session.
        </p>
      </Alert>
    {/if}
    {#if outcome.deliveredIn === 'fragment'}
      <Alert severity="info" title="Non-conformant error delivery">
        <p>
          The error arrived in the URL fragment; OAuth 2.0 puts it in the query string for the code
          flow. A stricter client would miss it.
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
          <code class="font-mono text-xs">invalid_grant</code>: the code expired or was already
          used, or <code class="font-mono text-xs">redirect_uri</code> did not exactly match the authorization
          request.
        </li>
        <li>
          <code class="font-mono text-xs">invalid_client</code>: the client ID or secret was
          rejected. Try another client authentication method under Testing options.
        </li>
        <li>
          Request never reached the server: the exchange log at the bottom has the raw attempt and a
          curl command.
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
  {:else if failure}
    <h1 class="text-2xl font-semibold">The callback failed unexpectedly</h1>
    <Alert severity="error" title="Swiss could not finish processing the server's response">
      <p class="font-mono text-xs break-all">{failure}</p>
      <p class="mt-2">
        The code may already have been exchanged. The exchange log has the raw token response.
      </p>
    </Alert>
    <a href="/launch" class="text-primary text-sm hover:underline">Start a new launch</a>
  {:else}
    <h1 class="text-2xl font-semibold">Nothing to complete</h1>
    <p class="text-fg-muted text-sm">
      This page handles the authorization server&rsquo;s redirect, but the URL carried no
      authorization response.
    </p>
    <a href="/launch" class="text-primary text-sm hover:underline">Go to Launch</a>
  {/if}
</div>
