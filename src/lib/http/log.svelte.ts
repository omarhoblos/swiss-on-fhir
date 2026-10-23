/*
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
*/

import { fenced } from '#lib/markdown.ts';
import { config } from '#lib/config/config.svelte.ts';
import { timestampedFilename } from '#lib/download.ts';
import { dedupeById, redactExchange, toCurl, type HttpExchange } from './exchange';
import { tab } from '#lib/tabs.svelte.ts';
import {
  clearLog,
  loadLog,
  MAX_ENTRIES_PER_TAB,
  MAX_ENTRIES_TOTAL,
  saveTabLog,
  type StoredExchange
} from './log-persist';

/**
 * A capped log of every exchange, so the user can inspect what actually went
 * over the wire without opening devtools.
 *
 * Bounded on purpose: a long diagnostics session plus a few paginated FHIR
 * bundles would otherwise grow without limit in a page that may stay open
 * for hours.
 *
 * Swiss is a static browser app, so it cannot append to a log file on disk.
 * What it does instead: keeps this buffer, persists the redacted form to
 * IndexedDB so events survive a reload and the OAuth redirect, and offers a
 * download as a timestamped file.
 */
/** Batch window for persistence, so a burst of probes is one write. */
const PERSIST_DEBOUNCE_MS = 400;

/** Which tabs' entries the drawer shows. */
export type LogScope = 'tab' | 'all';

class ExchangeLog {
  /** This tab's entries, newest first, unredacted in memory. */
  #entries = $state<HttpExchange[]>([]);
  /** Other tabs' entries, as stored: already redacted. Read-only here. */
  #others = $state<StoredExchange[]>([]);
  #scope = $state<LogScope>('tab');
  #hydrated = $state(false);
  #hydrating = false;
  #persistError = $state<string | null>(null);
  #persistTimer: ReturnType<typeof setTimeout> | null = null;
  #othersTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    tab.subscribe((message) => {
      if (message.type === 'log-changed' && message.tabId !== tab.id) this.#scheduleOthers();
    });
  }

  readonly scope = $derived(this.#scope);

  /**
   * The entries in view, newest first. One is shown unredacted only when its
   * own environment has redaction turned off: with every tab in view, one
   * environment's setting must not unmask another's credentials. Entries from
   * an environment that no longer exists stay redacted.
   */
  readonly entries = $derived.by(() => {
    const inView = this.#inView();
    // A cache for this one computation, not state: nothing reads it later.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const unmasked = new Map<string, boolean>();
    const showsSecrets = (envId: string) => {
      if (!unmasked.has(envId)) {
        unmasked.set(envId, config.effectiveFor(envId)?.redactSecrets === false);
      }
      return unmasked.get(envId) === true;
    };
    return inView.map((entry) =>
      showsSecrets(entry.environmentId ?? 'default') ? entry : redactExchange(entry)
    );
  });

  /** Entries in view. */
  readonly count = $derived(this.entries.length);

  /** Entries logged by other tabs, whether or not they are in view. */
  readonly otherTabsCount = $derived(this.#others.length);

  // A request stopped on this side is not a failure of the server.
  readonly failures = $derived(
    this.entries.filter((e) => e.outcome !== 'ok' && e.outcome !== 'aborted')
  );

  readonly hydrated = $derived(this.#hydrated);

  /** True once this tab's buffer is full and its older entries are being dropped. */
  readonly atCapacity = $derived(this.#entries.length >= MAX_ENTRIES_PER_TAB);

  readonly maxEntries = MAX_ENTRIES_PER_TAB;
  readonly maxEntriesTotal = MAX_ENTRIES_TOTAL;

  /** Set when persistence failed, so the drawer can say the log is memory-only. */
  readonly persistError = $derived(this.#persistError);

  setScope(scope: LogScope): void {
    this.#scope = scope;
    if (scope === 'all') this.#scheduleOthers(0);
  }

  /** Loads the persisted log. Called once from the root layout. */
  async hydrate(): Promise<void> {
    // Guarded before the await, not after: two overlapping calls would both
    // get past an `if (this.#hydrated)` check placed after it and each append
    // `stored`, duplicating every restored id.
    if (this.#hydrated || this.#hydrating) return;
    this.#hydrating = true;
    try {
      // A duplicated tab starts with the original's id; which entries are
      // this tab's is known only once that is settled.
      await tab.ready();
      const stored = await loadLog(tab.id);
      const mine = stored.filter((entry) => entry.tabId === tab.id);
      this.#others = stored.filter((entry) => entry.tabId !== tab.id);
      // Anything already recorded during this page view is newer than what was
      // on disk, so it stays in front.
      if (mine.length > 0) {
        this.#entries = dedupeById([...this.#entries, ...mine]).slice(0, MAX_ENTRIES_PER_TAB);
      }
      this.#hydrated = true;
    } finally {
      this.#hydrating = false;
    }
  }

  /**
   * The environment a request starting now belongs to. For callers outside
   * the stores (the FHIR client), so they can capture it before their first
   * await without importing the config store.
   */
  environmentNow(): string {
    return config.activeEnvironmentId;
  }

  /**
   * Adds an exchange. `environmentId` is the environment the request was
   * made for: callers capture it when the request starts, since the tab may
   * have switched by the time the answer arrives.
   */
  record(exchange: HttpExchange, environmentId = config.activeEnvironmentId): void {
    this.#entries = [this.#stamp(exchange, environmentId), ...this.#entries].slice(
      0,
      MAX_ENTRIES_PER_TAB
    );
    this.#schedulePersist();
  }

  recordAll(exchanges: HttpExchange[], environmentId = config.activeEnvironmentId): void {
    if (exchanges.length === 0) return;
    const stamped = exchanges.map((exchange) => this.#stamp(exchange, environmentId)).reverse();
    this.#entries = [...stamped, ...this.#entries].slice(0, MAX_ENTRIES_PER_TAB);
    this.#schedulePersist();
  }

  #stamp(exchange: HttpExchange, environmentId: string): HttpExchange {
    return { ...exchange, environmentId, tabLabel: tab.displayLabel };
  }

  #schedulePersist(): void {
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null;
      void this.#persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Reloads other tabs' entries, batched: a busy tab announces every save. */
  #scheduleOthers(delay = PERSIST_DEBOUNCE_MS): void {
    if (this.#othersTimer) clearTimeout(this.#othersTimer);
    this.#othersTimer = setTimeout(() => {
      this.#othersTimer = null;
      void loadLog(tab.id).then((stored) => {
        this.#others = stored.filter((entry) => entry.tabId !== tab.id);
      });
    }, delay);
  }

  async #persist(): Promise<void> {
    // ALWAYS the redacted form: exchanges carry live tokens, and the point of
    // persisting is to survive a reload, not to put credentials on disk.
    //
    // $state.snapshot is required, not cosmetic: #entries is reactive state,
    // so its members are Proxy objects, and IndexedDB's structured clone
    // throws DataCloneError on a Proxy. Without this every write fails.
    await tab.ready();
    const plain = $state
      .snapshot(this.#entries)
      .map((entry) => redactExchange(entry as HttpExchange));
    const { error } = await saveTabLog(tab.id, plain);
    this.#persistError = error;
    if (!error) tab.post({ type: 'log-changed', tabId: tab.id });
  }

  /** Clears what is in view: this tab's entries, or every tab's. */
  clear(): void {
    const allTabs = this.#scope === 'all';
    this.#entries = [];
    if (allTabs) this.#others = [];
    if (this.#persistTimer) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = null;
    }
    void clearLog(tab.id, { allTabs }).then(() => tab.post({ type: 'log-changed', tabId: tab.id }));
  }

  /** The entries in view without redaction applied: what an export starts from. */
  #inView(): HttpExchange[] {
    const own = this.#entries.map((entry) => ({
      ...entry,
      tabLabel: entry.tabLabel ?? tab.displayLabel
    }));
    return this.#scope === 'tab'
      ? own
      : [...own, ...this.#others].sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Exports the log. `includeSecrets` defaults to false so the result is safe
   * to paste into an issue; when false, each entry lists what was masked.
   */
  export(options: { includeSecrets?: boolean } = {}): string {
    const entries = options.includeSecrets ? this.#inView() : this.#inView().map(redactExchange);
    return JSON.stringify(
      {
        swissExchangeLogVersion: 1,
        exportedAt: new Date().toISOString(),
        origin: config.origin,
        redacted: !options.includeSecrets,
        entryCount: entries.length,
        entries
      },
      null,
      2
    );
  }

  /** A Markdown transcript, for pasting into an issue. */
  exportMarkdown(options: { includeSecrets?: boolean } = {}): string {
    const entries = options.includeSecrets ? this.#inView() : this.#inView().map(redactExchange);
    const origin = config.origin ?? 'unknown';

    const lines = [
      '# Swiss on FHIR exchange log',
      '',
      `Exported: ${new Date().toISOString()}`,
      `Origin: \`${origin}\``,
      `Entries: ${entries.length}${options.includeSecrets ? '' : ' (redacted)'}`,
      ''
    ];

    // Oldest first reads as a transcript, unlike the newest-first UI.
    for (const entry of [...entries].reverse()) {
      const status = entry.response
        ? `${entry.response.status} ${entry.response.statusText}`
        : entry.outcome;
      lines.push(
        `## ${entry.request.method} ${entry.request.url}`,
        '',
        `- Outcome: \`${entry.outcome}\` (${status})`,
        `- Duration: ${entry.durationMs}ms`,
        `- Started: ${new Date(entry.startedAt).toISOString()}`
      );
      // A code span cannot hold a backtick, so none survives into one.
      if (entry.tabLabel) lines.push(`- Tab: \`${entry.tabLabel.replace(/`/g, "'")}\``);
      if (entry.environmentId) lines.push(`- Environment: \`${entry.environmentId}\``);
      if (entry.redactions.length > 0) {
        lines.push(`- Redacted: ${entry.redactions.join(', ')}`);
      }
      if (entry.diagnosis) {
        lines.push(
          `- Likely cause: **${entry.diagnosis.likelyCause}** (${entry.diagnosis.confidence})`
        );
        for (const evidence of entry.diagnosis.evidence) lines.push(`  - ${evidence}`);
      }
      // Fenced with a run the content cannot close: headers, bodies and
      // URLs are server or user text, and a line of backticks in one of them
      // would otherwise end the block and be read as the report's own text.
      const request = [`${entry.request.method} ${entry.request.url}`];
      for (const [name, value] of Object.entries(entry.request.headers)) {
        request.push(`${name}: ${value}`);
      }
      if (entry.request.body) request.push('', entry.request.body);
      lines.push('', ...fenced(request.join('\n'), 'http'), '');
      if (entry.response?.body) {
        lines.push(...fenced(entry.response.body.slice(0, 8000), 'json'), '');
      }
      lines.push('<details><summary>Reproduce with curl</summary>', '');
      lines.push(...fenced(toCurl(entry, origin), 'bash'), '', '</details>', '');
    }

    return lines.join('\n');
  }

  filename(extension: 'json' | 'md'): string {
    return timestampedFilename('swiss-exchange-log', extension);
  }
}

export const exchangeLog = new ExchangeLog();
