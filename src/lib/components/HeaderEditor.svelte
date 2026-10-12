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
  import { clock } from '$lib/auth/session.svelte';
  import { headerProblem, headerValueNote } from '$lib/http/headers';
  import {
    AUTH_SCHEMES,
    basicProblem,
    encodeBasic,
    KNOWN_HEADERS,
    knownHeader,
    toHttpDate,
    valueHint
  } from '$lib/fhir/known-headers';
  import {
    blankRow,
    CREDENTIAL_TTL_MS,
    hasCredentials,
    parseStoredRows,
    rowValue,
    serializeRows,
    wipeCredentials,
    type HeaderRow
  } from '$lib/fhir/header-rows';
  import { formatCountdown } from '$lib/time';
  import Combobox from '$lib/components/ui/Combobox.svelte';
  import PlusCircle from '$lib/icons/PlusCircle.svelte';
  import MinusCircle from '$lib/icons/MinusCircle.svelte';

  /**
   * Key/value header rows, replacing the Angular FormArray.
   *
   * Rows are keyed by a generated id rather than by index. That fixes a real
   * bug in the original: with index-keyed *ngFor, removing a middle row
   * re-bound the surviving inputs to the wrong values.
   *
   * The name box offers the headers in KNOWN_HEADERS and the value box
   * follows the name: suggested values, a date picker, a UUID, or for
   * Authorization a scheme with a username and password that are encoded
   * here. Anything can still be typed into either box.
   *
   * The effective map is reported through a callback rather than a bindable
   * prop, so data flows one way and the parent is never written to from an
   * effect.
   */
  interface Row extends HeaderRow {
    id: string;
  }

  let {
    onChange,
    persistKey
  }: {
    onChange?: (headers: Record<string, string>) => void;
    /** localStorage key for persistence, if the caller wants it. */
    persistKey?: string;
  } = $props();

  const NAME_OPTIONS = KNOWN_HEADERS.map((h) => ({ value: h.name, description: h.description }));
  const INPUT =
    'border-border-control bg-bg min-w-36 flex-1 rounded-md border px-2 py-1.5 font-mono text-sm';

  let rows = $state<Row[]>([]);
  let persist = $state(false);
  /** Stored credentials reached their hour and were wiped, on load or while open. */
  let wipedNotice = $state(false);

  const withId = (row: HeaderRow): Row => ({ ...row, id: crypto.randomUUID() });

  // Read storage on mount rather than in a $state initialiser: an initialiser
  // captures props once, and this keeps localStorage off the render path.
  onMount(() => {
    if (!persistKey) return;
    try {
      const raw = localStorage.getItem(persistKey);
      const stored = parseStoredRows(raw, Date.now());
      rows = stored.rows.map(withId);
      wipedNotice = stored.wiped;
      persist = raw !== null;
    } catch {
      persist = false;
    }
  });

  /**
   * Why a row cannot be sent, or null. A blank row is not a problem, only
   * unfinished. `fetch` throws on a header it cannot send before anything
   * reaches the network, which the probe can only report as a likely CORS
   * failure -- so an invalid row is named here and left out instead.
   */
  function problemWith(row: Row): string | null {
    const name = row.key.trim();
    return name === '' ? null : headerProblem(name, rowValue(row));
  }

  /** A note about a value that looks wrong for its header. It is still sent. */
  function hintFor(row: Row): string | null {
    const known = knownHeader(row.key);
    if (known?.kind === 'authorization' && row.auth.scheme === 'Basic') {
      return basicProblem(row.auth.username);
    }
    const value = rowValue(row);
    return valueHint(row.key, value) ?? headerValueNote(value);
  }

  /**
   * Why a half-filled row is left out, or null. A row with neither part is
   * just new; one with only a name or only a value is said to be unsent, so
   * a header that was meant to go is not dropped without a word.
   */
  function missingFor(row: Row): string | null {
    const hasName = row.key.trim() !== '';
    const hasValue = rowValue(row).trim() !== '';
    if (hasName === hasValue) return null;
    if (!hasName) return 'No header name yet, so this value is not sent.';
    return knownHeader(row.key)?.kind === 'authorization'
      ? 'No credentials yet, so this header is not sent.'
      : 'No value yet, so this header is not sent.';
  }

  // Blank and invalid rows are excluded, so neither a half-typed header nor
  // one the browser would refuse reaches the wire.
  const effective = $derived(
    Object.fromEntries(
      rows
        .filter((r) => r.key.trim() !== '' && rowValue(r).trim() !== '' && problemWith(r) === null)
        .map((r) => [r.key.trim(), rowValue(r)])
    )
  );

  $effect(() => {
    onChange?.(effective);
  });

  $effect(() => {
    if (!persistKey || !persist) return;
    try {
      localStorage.setItem(persistKey, serializeRows(rows));
    } catch {
      /* storage unavailable */
    }
  });

  /**
   * Credentials are stored for an hour after they were last changed, so a
   * change restarts the hour and clearing them stops it.
   */
  function credentialsChanged(row: Row) {
    if (!hasCredentials(row)) {
      row.credentialsExpireAt = null;
      return;
    }
    wipedNotice = false;
    row.credentialsExpireAt = persist ? Date.now() + CREDENTIAL_TTL_MS : null;
  }

  const isExpired = (row: Row, now: number) =>
    row.credentialsExpireAt !== null && row.credentialsExpireAt <= now && hasCredentials(row);

  // Wipes from the form; the persist effect above then rewrites storage
  // without them.
  $effect(() => {
    const now = clock.now;
    if (!rows.some((r) => isExpired(r, now))) return;
    rows = rows.map((r) => (isExpired(r, now) ? wipeCredentials(r) : r));
    wipedNotice = true;
  });

  /** Seconds until the next stored credentials are wiped, or null if none are stored. */
  const wipeIn = $derived.by(() => {
    if (!persist) return null;
    const times = rows
      .filter((r) => r.credentialsExpireAt !== null && hasCredentials(r))
      .map((r) => r.credentialsExpireAt as number);
    if (times.length === 0) return null;
    return Math.max(0, Math.ceil((Math.min(...times) - clock.now) / 1000));
  });

  function add() {
    rows = [...rows, withId(blankRow())];
  }

  function remove(id: string) {
    rows = rows.filter((r) => r.id !== id);
  }

  /**
   * A header picked from the list. A value that was one of another header's
   * suggestions no longer means anything, so it goes; a typed one stays.
   */
  function nameChosen(row: Row, name: string) {
    const fits = knownHeader(name)?.suggestions?.some((s) => s.value === row.value);
    const suggested = KNOWN_HEADERS.some((h) => h.suggestions?.some((s) => s.value === row.value));
    if (suggested && !fits) row.value = '';
    credentialsChanged(row);
  }

  function togglePersist(on: boolean) {
    persist = on;
    const expireAt = Date.now() + CREDENTIAL_TTL_MS;
    for (const row of rows) {
      row.credentialsExpireAt = on && hasCredentials(row) ? expireAt : null;
    }
    if (!persistKey) return;
    try {
      if (on) {
        localStorage.setItem(persistKey, serializeRows(rows));
      } else {
        localStorage.removeItem(persistKey);
      }
    } catch {
      /* storage unavailable */
    }
  }

  /** Header names appearing more than once; only the last would be sent. */
  const duplicateKeys = $derived.by(() => {
    // A Map, because the names are typed text: on a plain object a header
    // called `constructor` starts from an inherited function, not from zero.
    // It is a throwaway tally inside a derived, never reactive state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = row.key.trim().toLowerCase();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].filter(([, n]) => n > 1).map(([key]) => key);
  });
</script>

<div class="space-y-2">
  <div class="flex items-center gap-2">
    <span class="text-sm font-medium">Headers</span>
    <button
      type="button"
      class="text-success hover:bg-surface-2 rounded p-1"
      onclick={add}
      aria-label="Add a header"
      title="Add a header"
    >
      <PlusCircle class="h-4 w-4" />
    </button>
  </div>

  {#each rows as row (row.id)}
    {@const known = knownHeader(row.key)}
    {@const problem = problemWith(row)}
    {@const missing = problem ? null : missingFor(row)}
    {@const hint = problem || missing ? null : hintFor(row)}
    <div class="flex flex-wrap items-start gap-2">
      <Combobox
        bind:value={row.key}
        options={NAME_OPTIONS}
        label="Header name"
        listLabel="known headers"
        placeholder="Header name"
        onselect={(name) => nameChosen(row, name)}
        oninput={() => credentialsChanged(row)}
        class="min-w-36 flex-1"
      />
      <div class="flex min-w-36 flex-1 flex-wrap items-center gap-2">
        {#if known?.kind === 'authorization'}
          <select
            bind:value={row.auth.scheme}
            onchange={() => credentialsChanged(row)}
            aria-label="Authorization scheme"
            class="border-border-control bg-bg rounded-md border py-1.5 pr-7 pl-2 font-mono text-sm"
          >
            {#each AUTH_SCHEMES as scheme (scheme)}
              <option value={scheme}>{scheme}</option>
            {/each}
          </select>
          {#if row.auth.scheme === 'Basic'}
            <input
              type="text"
              bind:value={row.auth.username}
              oninput={() => credentialsChanged(row)}
              placeholder="Username"
              aria-label="Username"
              spellcheck="false"
              autocomplete="off"
              class={INPUT}
            />
            <input
              type="password"
              bind:value={row.auth.password}
              oninput={() => credentialsChanged(row)}
              placeholder="Password"
              aria-label="Password"
              autocomplete="off"
              class={INPUT}
            />
          {:else if row.auth.scheme === 'Bearer'}
            <input
              type="text"
              bind:value={row.auth.token}
              oninput={() => credentialsChanged(row)}
              placeholder="Token"
              aria-label="Token"
              spellcheck="false"
              autocomplete="off"
              class={INPUT}
            />
          {:else}
            <input
              type="text"
              bind:value={row.value}
              oninput={() => credentialsChanged(row)}
              placeholder="Scheme and credentials"
              aria-label="Header value"
              spellcheck="false"
              autocomplete="off"
              class={INPUT}
            />
          {/if}
        {:else if known?.suggestions}
          <Combobox
            bind:value={row.value}
            options={known.suggestions}
            label="Header value"
            listLabel="suggested values"
            oninput={() => credentialsChanged(row)}
            placeholder={known.placeholder ?? 'Value'}
            class="min-w-36 flex-1"
          />
        {:else}
          <input
            type="text"
            bind:value={row.value}
            oninput={() => credentialsChanged(row)}
            placeholder={known?.placeholder ?? 'Value'}
            spellcheck="false"
            class={INPUT}
            aria-label="Header value"
          />
          {#if known?.kind === 'http-date'}
            <input
              type="datetime-local"
              onchange={(e) => {
                const date = toHttpDate(e.currentTarget.value);
                if (date) row.value = date;
              }}
              aria-label="Pick a date for {known.name}"
              title="Pick a date"
              class="border-border-control bg-bg rounded-md border px-2 py-1.5 text-sm"
            />
          {:else if known?.kind === 'request-id'}
            <button
              type="button"
              onclick={() => (row.value = crypto.randomUUID())}
              class="border-border-control text-fg-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm"
            >
              Generate
            </button>
          {/if}
        {/if}
      </div>
      <button
        type="button"
        class="text-error hover:bg-surface-2 mt-1 rounded p-1"
        onclick={() => remove(row.id)}
        aria-label="Remove this header"
        title="Remove this header"
      >
        <MinusCircle class="h-4 w-4" />
      </button>
      {#if known}
        <p class="text-fg-muted w-full text-xs">{known.description}</p>
      {/if}
      {#if problem}
        <p class="text-error w-full text-xs" role="alert">
          {problem} This header will not be sent.
        </p>
      {:else if missing}
        <p class="text-warning w-full text-xs">{missing}</p>
      {:else if hint}
        <p class="text-warning w-full text-xs">{hint} It will be sent as it is.</p>
      {/if}
      {#if known?.kind === 'authorization' && row.auth.scheme === 'Basic' && (row.auth.username || row.auth.password)}
        <details class="w-full text-xs">
          <summary class="text-fg-muted cursor-pointer">Show the encoded value</summary>
          <code class="mt-1 block font-mono break-all">
            {encodeBasic(row.auth.username, row.auth.password)}
          </code>
        </details>
      {/if}
    </div>
  {/each}

  {#if duplicateKeys.length > 0}
    <p class="text-warning text-xs">
      Duplicate header name(s): {duplicateKeys.join(', ')}. Only the last will be sent.
    </p>
  {/if}

  {#if persistKey}
    <label class="text-fg-muted flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={persist}
        onchange={(e) => togglePersist(e.currentTarget.checked)}
        class="accent-primary h-3.5 w-3.5"
      />
      Store these headers in this browser
      <span class="italic">(they persist after you log out of Swiss)</span>
    </label>
    {#if wipeIn !== null}
      <p class="text-warning text-xs">
        Credentials (Authorization, and headers named like a key, token, secret or password) are
        stored for an hour after you last change them, then wiped from this browser and from this
        form. Wiped in
        <span class="font-mono">{formatCountdown(wipeIn)}</span>.
      </p>
    {/if}
  {/if}
  {#if wipedNotice}
    <p class="text-warning text-xs" role="status">
      Stored credentials were wiped after an hour. Enter them again to send those headers.
    </p>
  {/if}
</div>
