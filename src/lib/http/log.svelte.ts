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

import { config } from '$lib/config/config.svelte';
import { timestampedFilename } from '$lib/download';
import { dedupeById, redactExchange, toCurl, type HttpExchange } from './exchange';
import { clearLog, loadLog, saveLog } from './log-persist';

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
const MAX_ENTRIES = 200;

/** Batch window for persistence, so a burst of probes is one write. */
const PERSIST_DEBOUNCE_MS = 400;

class ExchangeLog {
  #entries = $state<HttpExchange[]>([]);
  #hydrated = $state(false);
  #hydrating = false;
  #persistError = $state<string | null>(null);
  #persistTimer: ReturnType<typeof setTimeout> | null = null;

  /** Newest first, redacted unless the user has turned redaction off. */
  readonly entries = $derived(
    config.current.redactSecrets ? this.#entries.map(redactExchange) : this.#entries
  );

  readonly count = $derived(this.#entries.length);

  readonly failures = $derived(this.entries.filter((e) => e.outcome !== 'ok'));

  readonly hydrated = $derived(this.#hydrated);

  /** True once the buffer is full and older entries are being dropped. */
  readonly atCapacity = $derived(this.#entries.length >= MAX_ENTRIES);

  readonly maxEntries = MAX_ENTRIES;

  /** Set when persistence failed, so the drawer can say the log is memory-only. */
  readonly persistError = $derived(this.#persistError);

  /** Loads the persisted log. Called once from the root layout. */
  async hydrate(): Promise<void> {
    // Guarded before the await, not after: two overlapping calls would both
    // get past an `if (this.#hydrated)` check placed after it and each append
    // `stored`, duplicating every restored id.
    if (this.#hydrated || this.#hydrating) return;
    this.#hydrating = true;
    try {
      const stored = await loadLog();
      // Anything already recorded during this page view is newer than what was
      // on disk, so it stays in front.
      if (stored.length > 0) {
        this.#entries = dedupeById([...this.#entries, ...stored]).slice(0, MAX_ENTRIES);
      }
      this.#hydrated = true;
    } finally {
      this.#hydrating = false;
    }
  }

  record(exchange: HttpExchange): void {
    this.#entries = [exchange, ...this.#entries].slice(0, MAX_ENTRIES);
    this.#schedulePersist();
  }

  recordAll(exchanges: HttpExchange[]): void {
    if (exchanges.length === 0) return;
    this.#entries = [...exchanges.reverse(), ...this.#entries].slice(0, MAX_ENTRIES);
    this.#schedulePersist();
  }

  #schedulePersist(): void {
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null;
      void this.#persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  async #persist(): Promise<void> {
    // ALWAYS the redacted form: exchanges carry live tokens, and the point of
    // persisting is to survive a reload, not to put credentials on disk.
    //
    // $state.snapshot is required, not cosmetic: #entries is reactive state,
    // so its members are Proxy objects, and IndexedDB's structured clone
    // throws DataCloneError on a Proxy. Without this every write fails.
    const plain = $state
      .snapshot(this.#entries)
      .map((entry) => redactExchange(entry as HttpExchange));
    const { error } = await saveLog(plain);
    this.#persistError = error;
  }

  clear(): void {
    this.#entries = [];
    if (this.#persistTimer) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = null;
    }
    void clearLog();
  }

  /**
   * Exports the log. `includeSecrets` defaults to false so the result is safe
   * to paste into an issue; when false, each entry lists what was masked.
   */
  export(options: { includeSecrets?: boolean } = {}): string {
    const entries = options.includeSecrets ? this.#entries : this.#entries.map(redactExchange);
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
    const entries = options.includeSecrets ? this.#entries : this.#entries.map(redactExchange);
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
      if (entry.redactions.length > 0) {
        lines.push(`- Redacted: ${entry.redactions.join(', ')}`);
      }
      if (entry.diagnosis) {
        lines.push(
          `- Likely cause: **${entry.diagnosis.likelyCause}** (${entry.diagnosis.confidence})`
        );
        for (const evidence of entry.diagnosis.evidence) lines.push(`  - ${evidence}`);
      }
      lines.push('', '```http', `${entry.request.method} ${entry.request.url}`);
      for (const [name, value] of Object.entries(entry.request.headers)) {
        lines.push(`${name}: ${value}`);
      }
      if (entry.request.body) lines.push('', entry.request.body);
      lines.push('```', '');
      if (entry.response?.body) {
        lines.push('```json', entry.response.body.slice(0, 8000), '```', '');
      }
      lines.push('<details><summary>Reproduce with curl</summary>', '', '```bash');
      lines.push(toCurl(entry, origin));
      lines.push('```', '', '</details>', '');
    }

    return lines.join('\n');
  }

  filename(extension: 'json' | 'md'): string {
    return timestampedFilename('swiss-exchange-log', extension);
  }
}

export const exchangeLog = new ExchangeLog();
