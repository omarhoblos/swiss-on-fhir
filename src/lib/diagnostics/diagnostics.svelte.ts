import { session } from '$lib/auth/session.svelte';
import { config } from '$lib/config/config.svelte';
import { exchangeLog } from '$lib/http/log.svelte';
import { deriveFeatureGates } from '$lib/smart/capabilities';
import {
  fetchCapabilityOauthUris,
  fetchOpenidConfiguration,
  fetchSmartConfiguration,
  fetchSmartConfigurationAtRoot,
  mergeEndpoints,
  type DiscoveryDocuments
} from '$lib/smart/discovery';
import type { EndpointConflict, ResolvedEndpoints, SmartFeatureGates } from '$lib/smart/types';
import { ALL_CHECKS } from './checks';
import { runChecks, summarise, toMarkdown } from './runner';
import type { CheckResult, DiagnosticsContext } from './types';

/**
 * Discovery and diagnostics state.
 *
 * Re-discovery is EXPLICIT, not reactive. An $effect watching the config
 * fingerprint would refetch on every keystroke in the config editor, spam the
 * user's servers, and fill the exchange log with noise. Instead the store
 * records the fingerprint it last ran against and exposes `stale`, so the UI
 * can offer a "config changed -- re-run" button. Every request stays
 * traceable to something the user did.
 */
class DiagnosticsStore {
  #docs = $state<DiscoveryDocuments>({});
  #documentUrls = $state<Record<string, string>>({});
  #endpoints = $state<ResolvedEndpoints>({});
  #conflicts = $state<EndpointConflict[]>([]);
  #gates = $state<SmartFeatureGates | null>(null);
  #results = $state<CheckResult[]>([]);
  #running = $state(false);
  #discovering = $state(false);
  #ranAtFingerprint = $state<string | null>(null);
  #ranAt = $state<number | null>(null);
  #controller: AbortController | null = null;

  readonly docs = $derived(this.#docs);
  readonly documentUrls = $derived(this.#documentUrls);
  readonly endpoints = $derived(this.#endpoints);
  readonly conflicts = $derived(this.#conflicts);
  readonly gates = $derived(this.#gates);
  readonly results = $derived(this.#results);
  readonly running = $derived(this.#running || this.#discovering);
  readonly ranAt = $derived(this.#ranAt);
  readonly summary = $derived(summarise(this.#results));
  readonly hasRun = $derived(this.#ranAtFingerprint !== null);

  /** True when the configuration changed after the last run. */
  readonly stale = $derived(
    this.#ranAtFingerprint !== null && this.#ranAtFingerprint !== config.fingerprint
  );

  /** Fetches the three discovery documents and merges them. */
  async discover(): Promise<void> {
    this.#discovering = true;
    try {
      const docs: DiscoveryDocuments = {};
      const urls: Record<string, string> = {};

      const smart = await fetchSmartConfiguration(config.current.fhirBaseUrl);
      exchangeLog.record(smart.exchange);
      if (smart.document) {
        docs['smart-configuration'] = smart.document;
        urls['smart-configuration'] = smart.url;
      } else {
        const atRoot = await fetchSmartConfigurationAtRoot(config.current.fhirBaseUrl);
        if (atRoot) {
          exchangeLog.record(atRoot.exchange);
          if (atRoot.document) {
            docs['smart-configuration'] = atRoot.document;
            urls['smart-configuration'] = atRoot.url;
          }
        }
      }

      // Prefer the issuer the SMART document declares, since the FHIR server
      // is authoritative about which authorization server protects it.
      const declaredIssuer = docs['smart-configuration']?.issuer;
      const issuerToProbe =
        typeof declaredIssuer === 'string' && declaredIssuer
          ? declaredIssuer
          : config.current.authIssuer;

      if (issuerToProbe) {
        const openid = await fetchOpenidConfiguration(issuerToProbe);
        exchangeLog.record(openid.exchange);
        if (openid.document) {
          docs['openid-configuration'] = openid.document;
          urls['openid-configuration'] = openid.url;
        }
      }

      const capability = await fetchCapabilityOauthUris(config.current.fhirBaseUrl);
      exchangeLog.record(capability.exchange);
      if (capability.document) {
        docs['capability-statement'] = capability.document;
        urls['capability-statement'] = capability.url;
      }

      const { resolved, conflicts } = mergeEndpoints(docs);
      this.#docs = docs;
      this.#documentUrls = urls;
      this.#endpoints = resolved;
      this.#conflicts = conflicts;
      this.#gates = docs['smart-configuration']
        ? deriveFeatureGates(docs['smart-configuration'])
        : null;
    } finally {
      this.#discovering = false;
    }
  }

  async run(options: { includeMutating?: boolean } = {}): Promise<void> {
    if (this.#running) return;

    this.#results = [];
    this.#controller = new AbortController();

    await this.discover();

    this.#running = true;
    try {
      const ctx: DiagnosticsContext = {
        config: config.current,
        origin: config.origin,
        endpoints: this.#endpoints,
        docs: this.#docs,
        gates: this.#gates,
        documentUrls: this.#documentUrls,
        // Was hardcoded null, so no check could see a live session at all --
        // which is why the grant check warned that refresh tokens were
        // unavailable while the session was holding one.
        session: session.current
          ? {
              hasRefreshToken: Boolean(session.tokens?.refresh_token),
              staleConfig: session.staleConfig,
              grantedScopes: session.tokens?.scope
            }
          : null
      };

      await runChecks(ALL_CHECKS, ctx, {
        includeMutating: options.includeMutating ?? false,
        signal: this.#controller.signal,
        onResult: (result) => {
          // Append as they land so rows appear progressively.
          this.#results = [...this.#results, result];
          exchangeLog.recordAll(result.exchanges);
        }
      });

      this.#ranAtFingerprint = config.fingerprint;
      this.#ranAt = Date.now();
    } finally {
      this.#running = false;
      this.#controller = null;
    }
  }

  abort(): void {
    this.#controller?.abort();
  }

  exportMarkdown(): string {
    return toMarkdown(this.#results, { origin: config.origin });
  }
}

export const diagnostics = new DiagnosticsStore();
