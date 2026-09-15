<script lang="ts">
  import { onMount } from 'svelte';
  import PlusCircle from '$lib/icons/PlusCircle.svelte';
  import MinusCircle from '$lib/icons/MinusCircle.svelte';

  /**
   * Key/value header rows, replacing the Angular FormArray.
   *
   * Rows are keyed by a generated id rather than by index. That fixes a real
   * bug in the original: with index-keyed *ngFor, removing a middle row
   * re-bound the surviving inputs to the wrong values.
   *
   * The effective map is reported through a callback rather than a bindable
   * prop, so data flows one way and the parent is never written to from an
   * effect.
   */
  interface Row {
    id: string;
    key: string;
    value: string;
  }

  let {
    onChange,
    persistKey
  }: {
    onChange?: (headers: Record<string, string>) => void;
    /** localStorage key for persistence, if the caller wants it. */
    persistKey?: string;
  } = $props();

  let rows = $state<Row[]>([]);
  let persist = $state(false);

  function load(key: string): Row[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
        .map((r) => ({
          id: crypto.randomUUID(),
          key: String(r.key ?? ''),
          value: String(r.value ?? '')
        }));
    } catch {
      return [];
    }
  }

  // Read storage on mount rather than in a $state initialiser: an initialiser
  // captures props once, and this keeps localStorage off the render path.
  onMount(() => {
    if (!persistKey) return;
    rows = load(persistKey);
    try {
      persist = localStorage.getItem(persistKey) !== null;
    } catch {
      persist = false;
    }
  });

  // Blank rows are excluded, so a half-typed header never reaches the wire.
  const effective = $derived(
    Object.fromEntries(
      rows
        .filter((r) => r.key.trim() !== '' && r.value.trim() !== '')
        .map((r) => [r.key.trim(), r.value])
    )
  );

  $effect(() => {
    onChange?.(effective);
  });

  $effect(() => {
    if (!persistKey || !persist) return;
    try {
      localStorage.setItem(
        persistKey,
        JSON.stringify(rows.map((r) => ({ key: r.key, value: r.value })))
      );
    } catch {
      /* storage unavailable */
    }
  });

  function add() {
    rows = [...rows, { id: crypto.randomUUID(), key: '', value: '' }];
  }

  function remove(id: string) {
    rows = rows.filter((r) => r.id !== id);
  }

  function togglePersist(on: boolean) {
    persist = on;
    if (!persistKey) return;
    try {
      if (on) {
        localStorage.setItem(
          persistKey,
          JSON.stringify(rows.map((r) => ({ key: r.key, value: r.value })))
        );
      } else {
        localStorage.removeItem(persistKey);
      }
    } catch {
      /* storage unavailable */
    }
  }

  /** Header names appearing more than once; only the last would be sent. */
  const duplicateKeys = $derived.by(() => {
    // A plain object rather than a Map: this is a throwaway tally inside a
    // derived, so reactive-collection lint guidance does not apply.
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const key = row.key.trim().toLowerCase();
      if (!key) continue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts)
      .filter(([, n]) => n > 1)
      .map(([key]) => key);
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
    <div class="flex flex-wrap items-center gap-2">
      <input
        type="text"
        bind:value={row.key}
        placeholder="Header name"
        spellcheck="false"
        class="border-border bg-bg min-w-36 flex-1 rounded-md border px-2 py-1 font-mono text-xs"
        aria-label="Header name"
      />
      <input
        type="text"
        bind:value={row.value}
        placeholder="Value"
        spellcheck="false"
        class="border-border bg-bg min-w-36 flex-1 rounded-md border px-2 py-1 font-mono text-xs"
        aria-label="Header value"
      />
      <button
        type="button"
        class="text-error hover:bg-surface-2 rounded p-1"
        onclick={() => remove(row.id)}
        aria-label="Remove this header"
        title="Remove this header"
      >
        <MinusCircle class="h-4 w-4" />
      </button>
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
  {/if}
</div>
