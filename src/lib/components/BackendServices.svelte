<script lang="ts">
  import { onMount } from 'svelte';
  import { config } from '$lib/config/config.svelte';
  import { diagnostics } from '$lib/diagnostics/diagnostics.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { exchangeLog } from '$lib/http/log.svelte';
  import { copyToClipboard } from '$lib/clipboard';
  import {
    requestBackendToken,
    suggestSystemScopes,
    type BuiltAssertion
  } from '$lib/oidc/assertion';
  import {
    canGenerateKeys,
    deleteKeyPair,
    exportPublicJwks,
    generateKeyPair,
    keyPairInfo,
    type KeyPairInfo,
    type SigningAlg
  } from '$lib/oidc/keys';
  import { resolveLaunchContext } from '$lib/smart/context';
  import { formatAbsolute } from '$lib/time';
  import Alert from './ui/Alert.svelte';
  import Card from './ui/Card.svelte';

  let keyInfo = $state<KeyPairInfo | null>(null);
  let jwks = $state<string | null>(null);
  let alg = $state<SigningAlg>('RS384');
  let scope = $state('');
  let busy = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  let assertion = $state<BuiltAssertion | null>(null);
  let copied = $state<string | null>(null);

  const tokenEndpoint = $derived(diagnostics.endpoints.token_endpoint?.value ?? null);

  onMount(() => {
    void refreshKey();
    scope = suggestSystemScopes(config.current.scopes);
  });

  async function refreshKey() {
    keyInfo = await keyPairInfo();
    const exported = await exportPublicJwks();
    jwks = exported ? JSON.stringify(exported, null, 2) : null;
  }

  async function generate() {
    busy = true;
    error = null;
    message = null;
    try {
      keyInfo = await generateKeyPair(alg);
      await refreshKey();
      message = `Generated a ${alg} key pair. Register the public JWKS below with your authorization server.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    await deleteKeyPair();
    keyInfo = null;
    jwks = null;
    assertion = null;
    message = 'Key deleted. A new one will need registering again.';
  }

  async function copy(text: string, label: string) {
    if (await copyToClipboard(text)) {
      copied = label;
      setTimeout(() => (copied = null), 1600);
    }
  }

  async function requestToken() {
    if (!tokenEndpoint) {
      await diagnostics.discover();
    }
    const endpoint = diagnostics.endpoints.token_endpoint?.value;
    if (!endpoint) {
      error = 'No token endpoint was discovered. Run Diagnostics to see whether discovery works.';
      return;
    }

    busy = true;
    error = null;
    message = null;
    try {
      const result = await requestBackendToken({
        tokenEndpoint: endpoint,
        clientId: config.current.clientId,
        scope
      });

      if (result.assertion) assertion = result.assertion;
      if (result.exchange) exchangeLog.record(result.exchange);

      if (result.buildError) {
        error = result.buildError;
        return;
      }
      if (result.error) {
        error = `${result.error.error}${result.error.error_description ? `: ${result.error.error_description}` : ''}`;
        return;
      }
      if (!result.tokens) {
        error =
          'The request did not complete. The exchange log on the Diagnostics page has the raw attempt.';
        return;
      }

      const obtainedAt = Date.now();
      session.establish({
        tokens: result.tokens,
        // Context-free by definition: there is no user and no launch.
        context: resolveLaunchContext(result.tokens),
        obtainedAt,
        expiresAt:
          typeof result.tokens.expires_in === 'number'
            ? obtainedAt + result.tokens.expires_in * 1000
            : null,
        requestedScopes: scope,
        intent: { flavor: 'backend-services' },
        configSnapshot: config.current,
        tokenEndpoint: endpoint,
        revocationEndpoint: diagnostics.endpoints.revocation_endpoint?.value,
        endSessionEndpoint: undefined
      });
      message = 'Access token obtained. There is no launch context or ID token in this flow.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-6">
  {#if !canGenerateKeys()}
    <Alert severity="error" title="Key generation is unavailable on this origin">
      <p>
        Backend services needs <code class="font-mono text-xs">crypto.subtle</code> and IndexedDB.
        crypto.subtle requires a secure context, so use
        <code class="font-mono text-xs">http://localhost:4200</code> or serve Swiss over HTTPS.
      </p>
    </Alert>
  {/if}

  {#if message}
    <Alert severity="info">{message}</Alert>
  {/if}
  {#if error}
    <Alert severity="error" title="Backend services request failed">
      <p>{error}</p>
    </Alert>
  {/if}

  <Card title="Signing key" subtitle="Used to sign the JWT client assertion.">
    {#if keyInfo}
      <dl class="space-y-1.5 text-xs">
        <div class="flex flex-wrap gap-2">
          <dt class="text-fg-muted w-28 shrink-0">Algorithm</dt>
          <dd class="font-mono">{keyInfo.alg}</dd>
        </div>
        <div class="flex flex-wrap gap-2">
          <dt class="text-fg-muted w-28 shrink-0">Key ID (kid)</dt>
          <dd class="font-mono break-all">{keyInfo.kid}</dd>
        </div>
        <div class="flex flex-wrap gap-2">
          <dt class="text-fg-muted w-28 shrink-0">Created</dt>
          <dd>{formatAbsolute(new Date(keyInfo.createdAt))}</dd>
        </div>
        <div class="flex flex-wrap gap-2">
          <dt class="text-fg-muted w-28 shrink-0">Private key</dt>
          <dd class={keyInfo.extractable ? 'text-warning' : 'text-success'}>
            {keyInfo.extractable
              ? 'extractable — readable by any script on this origin'
              : 'non-extractable — usable for signing, but cannot be read out'}
          </dd>
        </div>
      </dl>

      <Alert severity="info" title="This key cannot be backed up">
        <p class="mt-1">
          The private key is non-extractable, so an XSS on this origin could use it while a tab is
          open but could never exfiltrate it. The cost of that protection is that there is no way to
          export or move it: if you clear this browser&rsquo;s storage, generate a new key and
          re-register the public JWKS.
        </p>
        <p class="mt-2">
          A browser is still a weaker place to keep a signing key than a server. Use this against
          servers you control.
        </p>
      </Alert>

      <button
        type="button"
        class="border-error text-error mt-3 rounded-md border px-2 py-1 text-xs"
        onclick={remove}
      >
        Delete this key
      </button>
    {:else}
      <p class="text-fg-muted text-sm">No signing key yet.</p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <select
          bind:value={alg}
          class="border-border bg-bg rounded-md border px-2 py-1.5 font-mono text-sm"
          aria-label="Signing algorithm"
        >
          <option value="RS384">RS384 (RSA 2048)</option>
          <option value="ES384">ES384 (EC P-384)</option>
        </select>
        <button
          type="button"
          class="bg-primary rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          disabled={busy || !canGenerateKeys()}
          onclick={generate}
        >
          {busy ? 'Generating…' : 'Generate a key pair'}
        </button>
      </div>
      <p class="text-fg-muted mt-2 text-xs">
        SMART Backend Services permits RS384 and ES384. The private key is generated non-extractable
        and kept in IndexedDB.
      </p>
    {/if}
  </Card>

  {#if jwks}
    <Card title="Public JWKS" subtitle="Register this with your authorization server.">
      {#snippet actions()}
        <button
          type="button"
          class="border-border text-fg-muted hover:text-fg rounded border px-2 py-1 text-xs"
          onclick={() => copy(jwks ?? '', 'jwks')}
        >
          {copied === 'jwks' ? 'Copied' : 'Copy'}
        </button>
      {/snippet}
      <pre
        class="bg-bg border-border max-h-64 overflow-auto rounded border p-2 font-mono text-[11px]">{jwks}</pre>
      <p class="text-fg-muted mt-2 text-xs">
        Most servers accept a pasted JWKS. If yours wants a URL instead, note that Swiss is served
        as static files, so you can place this JSON at
        <code class="font-mono">static/.well-known/jwks.json</code> in the repository and point the
        server at <code class="font-mono">{config.origin}/.well-known/jwks.json</code>.
      </p>
    </Card>
  {/if}

  <Card title="Request a token" subtitle="grant_type=client_credentials with the signed assertion.">
    <div class="space-y-3">
      <div>
        <label for="backend-scope" class="text-sm font-medium">System scopes</label>
        <input
          id="backend-scope"
          type="text"
          bind:value={scope}
          spellcheck="false"
          class="border-border bg-bg mt-1 w-full rounded-md border px-2 py-1.5 font-mono text-xs"
        />
        <p class="text-fg-muted mt-1 text-xs">
          Backend services uses <code class="font-mono">system/</code> scopes. Patient- and user-level
          scopes, and the OIDC and launch scopes, are meaningless here because there is no user &mdash;
          Swiss pre-fills a translation of your configured scopes.
        </p>
      </div>

      <dl class="space-y-1 text-xs">
        <div class="flex flex-wrap gap-2">
          <dt class="text-fg-muted w-28 shrink-0">Token endpoint</dt>
          <dd class="font-mono break-all">{tokenEndpoint ?? 'not discovered yet'}</dd>
        </div>
        <div class="flex flex-wrap gap-2">
          <dt class="text-fg-muted w-28 shrink-0">Client ID</dt>
          <dd class="font-mono">{config.current.clientId || '(not set)'}</dd>
        </div>
      </dl>

      <button
        type="button"
        class="bg-primary rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        disabled={busy || !keyInfo || !config.current.clientId}
        onclick={requestToken}
      >
        {busy ? 'Requesting…' : 'Request access token'}
      </button>
    </div>

    {#if assertion}
      <details class="border-border mt-4 rounded-md border" open>
        <summary class="px-3 py-1.5 text-xs font-medium">The assertion that was signed</summary>
        <div class="space-y-2 px-3 pb-3">
          <div>
            <p class="text-fg-muted text-xs">Header</p>
            <pre
              class="bg-bg border-border mt-1 overflow-auto rounded border p-2 font-mono text-[11px]">{JSON.stringify(
                assertion.header,
                null,
                2
              )}</pre>
          </div>
          <div>
            <p class="text-fg-muted text-xs">Claims</p>
            <pre
              class="bg-bg border-border mt-1 overflow-auto rounded border p-2 font-mono text-[11px]">{JSON.stringify(
                assertion.claims,
                null,
                2
              )}</pre>
            <p class="text-fg-muted mt-1 text-xs">
              Note that <code class="font-mono">aud</code> is the token endpoint, not the FHIR server
              &mdash; a common source of rejected assertions.
            </p>
          </div>
          <button
            type="button"
            class="border-border text-fg-muted hover:text-fg rounded border px-2 py-1 text-xs"
            onclick={() => copy(assertion?.jwt ?? '', 'jwt')}
          >
            {copied === 'jwt' ? 'Copied' : 'Copy the signed JWT'}
          </button>
        </div>
      </details>
    {/if}
  </Card>
</div>
