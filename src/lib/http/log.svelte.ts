import { config } from '$lib/config/config.svelte';
import { redactExchange, type HttpExchange } from './exchange';

/**
 * A capped log of every exchange, so the user can inspect what actually went
 * over the wire without opening devtools.
 *
 * Bounded on purpose: a long diagnostics session plus a few paginated FHIR
 * bundles would otherwise grow without limit in a page that may stay open
 * for hours.
 */
const MAX_ENTRIES = 200;

class ExchangeLog {
  #entries = $state<HttpExchange[]>([]);

  /** Newest first, redacted unless the user has turned redaction off. */
  readonly entries = $derived(
    config.current.redactSecrets ? this.#entries.map(redactExchange) : this.#entries
  );

  readonly count = $derived(this.#entries.length);

  readonly failures = $derived(this.entries.filter((e) => e.outcome !== 'ok'));

  record(exchange: HttpExchange): void {
    this.#entries = [exchange, ...this.#entries].slice(0, MAX_ENTRIES);
  }

  recordAll(exchanges: HttpExchange[]): void {
    for (const exchange of exchanges) this.record(exchange);
  }

  clear(): void {
    this.#entries = [];
  }

  /**
   * Exports the log. `includeSecrets` defaults to false so the result is safe
   * to paste into an issue; when false, each entry lists what was masked.
   */
  export(options: { includeSecrets?: boolean } = {}): string {
    const entries = options.includeSecrets ? this.#entries : this.#entries.map(redactExchange);
    return JSON.stringify({ swissExchangeLogVersion: 1, entries }, null, 2);
  }
}

export const exchangeLog = new ExchangeLog();
