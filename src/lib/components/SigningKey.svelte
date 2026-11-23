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

<!--
  The active environment's signing key: generate, import, delete, and its
  public JWKS. It signs Backend Services assertions and private_key_jwt sign-ins.
-->
<script lang="ts">
  import { config } from '#lib/config/config.svelte.ts';
  import {
    canGenerateKeys,
    deleteKeyPair,
    exportPublicJwks,
    generateKeyPair,
    keyPairInfo,
    storeKeyPair,
    type KeyPairInfo,
    type SigningAlg
  } from '#lib/oidc/keys.ts';
  import { importPrivateKey, readKeyText } from '#lib/oidc/key-import.ts';
  import { formatAbsolute } from '#lib/time.ts';
  import Alert from './ui/Alert.svelte';
  import CopyButton from './ui/CopyButton.svelte';

  /** Off where the surrounding card already says "Signing key". */
  let { heading = true }: { heading?: boolean } = $props();

  let keyInfo = $state<KeyPairInfo | null>(null);
  let jwks = $state<string | null>(null);
  let alg = $state<SigningAlg>('RS384');
  let busy = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);

  /** Bringing in a key made elsewhere, for a client already registered with it. */
  let importing = $state(false);
  let keyText = $state('');
  let replaceConfirmed = $state(false);

  // Each environment has its own key: re-read when the environment changes.
  $effect(() => {
    const envId = config.activeEnvironmentId;
    message = null;
    error = null;
    void refreshKey(envId);
  });

  async function refreshKey(envId: string) {
    const info = await keyPairInfo(envId);
    const exported = await exportPublicJwks(envId);
    if (config.activeEnvironmentId !== envId) return;
    keyInfo = info;
    jwks = exported ? JSON.stringify(exported, null, 2) : null;
  }

  async function generate() {
    busy = true;
    error = null;
    message = null;
    try {
      const envId = config.activeEnvironmentId;
      await generateKeyPair(envId, alg);
      await refreshKey(envId);
      message = `Generated a ${alg} key pair. Register the public JWKS below with your authorization server.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  async function readKeyFile(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    if (file) keyText = await file.text();
  }

  async function importKey() {
    error = null;
    message = null;
    const input = readKeyText(keyText);
    if ('error' in input) {
      error = input.error;
      return;
    }
    if (keyInfo && !replaceConfirmed) {
      error =
        'This environment already has a key, which may be the one registered with your server. Tick the box to replace it.';
      return;
    }
    busy = true;
    try {
      const envId = config.activeEnvironmentId;
      const result = await importPrivateKey(input);
      if (!result.ok) {
        error = result.error;
        return;
      }
      await storeKeyPair(envId, result, 'imported');
      await refreshKey(envId);
      message = `Imported a ${result.alg} key (kid ${result.kid}). Its public JWKS is below.`;
      importing = false;
      replaceConfirmed = false;
    } finally {
      // The key text is not kept, whatever happened.
      keyText = '';
      busy = false;
    }
  }

  async function remove() {
    const envId = config.activeEnvironmentId;
    await deleteKeyPair(envId);
    await refreshKey(envId);
    message = 'Key deleted. A new one will need registering again.';
  }
</script>

<div class="space-y-3" data-testid="signing-key">
  {#if heading}
    <h3 class="text-sm font-medium">Signing key</h3>
  {/if}

  {#if !canGenerateKeys()}
    <Alert severity="error" title="Key generation is unavailable on this origin">
      <p>
        Signing keys need <code class="font-mono text-xs">crypto.subtle</code>, which needs a secure
        context, and IndexedDB. Use
        <code class="font-mono text-xs">http://localhost:4200</code> or HTTPS.
      </p>
    </Alert>
  {/if}
  {#if message}
    <Alert severity="info">{message}</Alert>
  {/if}
  {#if error}
    <Alert severity="error" title="Signing key not changed">
      <p>{error}</p>
    </Alert>
  {/if}

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
        <dt class="text-fg-muted w-28 shrink-0">Source</dt>
        <dd>
          {keyInfo.source === 'generated'
            ? 'generated in this browser'
            : keyInfo.source === 'imported'
              ? 'imported'
              : 'shipped with the deployment'}
        </dd>
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
      <ul class="list-disc space-y-0.5 pl-5">
        <li>Non-extractable: a script on this origin can sign with it, but cannot copy it out.</li>
        <li>
          It cannot be exported. If you clear this browser&rsquo;s storage, generate a new key and
          re-register the public JWKS.
        </li>
        <li>
          A browser is weaker than a server for signing keys: use it with servers you control.
        </li>
      </ul>
    </Alert>

    <button
      type="button"
      class="border-error text-error rounded-md border px-2 py-1 text-xs"
      onclick={remove}
    >
      Delete this key
    </button>
  {:else}
    <p class="text-fg-muted text-sm">No signing key yet.</p>
    <div class="flex flex-wrap items-center gap-2">
      <select
        bind:value={alg}
        class="border-border-control bg-bg rounded-md border py-1.5 pr-7 pl-2 font-mono text-sm"
        aria-label="Signing algorithm"
      >
        <option value="RS384">RS384 (RSA 2048)</option>
        <option value="ES384">ES384 (EC P-384)</option>
      </select>
      <button
        type="button"
        class="bg-primary text-on-primary rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        disabled={busy || !canGenerateKeys()}
        onclick={generate}
      >
        {busy ? 'Generating…' : 'Generate a key pair'}
      </button>
    </div>
    <p class="text-fg-muted text-xs">
      SMART Backend Services allows RS384 and ES384. The private key is non-extractable and kept in
      IndexedDB.
    </p>
  {/if}

  <div class="border-border border-t pt-3">
    <button
      type="button"
      class="text-primary text-xs hover:underline"
      aria-expanded={importing}
      onclick={() => (importing = !importing)}
    >
      Import a private key
    </button>
    {#if importing}
      <div class="mt-2 space-y-2">
        <ul class="text-fg-muted list-disc space-y-0.5 pl-5 text-xs">
          <li>
            A private JWK or PKCS#8 PEM (<code class="font-mono">-----BEGIN PRIVATE KEY-----</code>)
          </li>
          <li>RSA of 2048 bits or more signs RS384; EC P-384 signs ES384</li>
          <li>Stored non-extractable; the pasted text is not kept</li>
        </ul>
        <input
          type="file"
          aria-label="Choose a private key file"
          onchange={readKeyFile}
          class="text-fg-muted file:border-border-control file:bg-bg file:text-fg hover:file:bg-surface-2 block cursor-pointer text-xs file:mr-2 file:cursor-pointer file:rounded-md file:border file:px-2.5 file:py-1 file:font-medium"
        />
        <textarea
          bind:value={keyText}
          rows="4"
          spellcheck="false"
          autocomplete="off"
          aria-label="Private key"
          placeholder="-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----"
          class="border-border-control bg-bg w-full rounded-md border px-2 py-1.5 font-mono text-xs"
        ></textarea>
        {#if keyInfo}
          <label class="text-warning flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              bind:checked={replaceConfirmed}
              class="accent-primary mt-0.5 h-3.5 w-3.5"
            />
            Replace the key this environment holds ({keyInfo.kid}). If your server has that key
            registered, requests fail until you register the new one.
          </label>
        {/if}
        <button
          type="button"
          class="bg-primary text-on-primary rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          disabled={busy || keyText.trim() === '' || (keyInfo !== null && !replaceConfirmed)}
          onclick={importKey}
        >
          Import key
        </button>
      </div>
    {/if}
  </div>

  {#if jwks}
    <div class="border-border border-t pt-3">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-medium">Public JWKS</h3>
        <span class="ml-auto"><CopyButton value={jwks ?? ''} /></span>
      </div>
      <p class="text-fg-muted mt-1 mb-2 text-xs">Register this with your authorization server.</p>
      <pre
        class="bg-bg border-border max-h-64 overflow-auto rounded border p-2 font-mono text-[11px]">{jwks}</pre>
      <p class="text-fg-muted mt-2 text-xs">
        Paste it into your server. If it wants a URL, save this JSON as
        <code class="font-mono">static/.well-known/jwks.json</code> in the repository and use
        <code class="font-mono">{config.origin}/.well-known/jwks.json</code>.
      </p>
    </div>
  {/if}
</div>
