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
  /** Discoveries in progress. A count, since an out-of-date one can still be finishing. */
  #discoveries = $state(0);
  #stopped = $state(false);
  #ranAtFingerprint = $state<string | null>(null);
  #ranAt = $state<number | null>(null);
  #discoveredFor = $state<string | null>(null);
  #configuredIssuerSkipped = $state(false);
  #controller: AbortController | null = null;
  /**
   * The discovery now running, what it is for, and how to stop it. A second
   * caller asking for the same base and issuer shares it.
   */
  #inFlight: { key: string; done: Promise<void>; controller: AbortController } | null = null;

  readonly docs = $derived(this.#docs);
  readonly documentUrls = $derived(this.#documentUrls);
  readonly endpoints = $derived(this.#endpoints);
  readonly conflicts = $derived(this.#conflicts);
  readonly gates = $derived(this.#gates);
  readonly results = $derived(this.#results);
  readonly discovering = $derived(this.#discoveries > 0);
  readonly running = $derived(this.#running || this.discovering);
  /** True when the last run was ended with Stop rather than finishing. */
  readonly stopped = $derived(this.#stopped);
  /**
   * True when the last discovery was for an EHR launch whose server named no
   * issuer, and the configured one was deliberately not asked instead.
   */
  readonly configuredIssuerSkipped = $derived(this.#configuredIssuerSkipped);
  /** True once discovery has finished for the base and issuer now configured. */
  readonly discovered = $derived(
    this.#discoveredFor !== null && this.#discoveredFor === discoveryKey()
  );
  readonly ranAt = $derived(this.#ranAt);
  readonly summary = $derived(summarise(this.#results));
  readonly hasRun = $derived(this.#ranAtFingerprint !== null);

  /** True when the configuration changed after the last run. */
  readonly stale = $derived(
    this.#ranAtFingerprint !== null && this.#ranAtFingerprint !== config.fingerprint
  );

  /**
   * True when the endpoints held here were discovered from a different FHIR
   * base or issuer than the ones now configured.
   *
   * Not the same as `stale`: that follows the auth fingerprint and only
   * drives a "re-run" button. This one is a safety property. An EHR launch
   * link overrides the FHIR base for one page, and the endpoints discovered
   * under it would otherwise be reused by the next launch -- sending the
   * user, and a configured client secret, to a server named by a link.
   */
  readonly discoveryStale = $derived(
    this.#discoveredFor !== null && this.#discoveredFor !== discoveryKey()
  );

  /**
   * Fetches the three discovery documents and merges them.
   *
   * Callers asking for the same base and issuer while a run is in flight
   * share it. The Launch page discovers when it opens, and "Start launch"
   * discovers when nothing is held yet; without this, clicking during the
   * first would fetch every document twice and log each exchange twice.
   */
  discover(): Promise<void> {
    const key = discoveryKey();
    if (this.#inFlight?.key === key) return this.#inFlight.done;

    // One for another base or issuer is out of date, and would only be
    // overwritten; stop it rather than let it finish and race this one.
    this.#inFlight?.controller.abort();

    const controller = new AbortController();
    const done = this.#discover(key, controller.signal).finally(() => {
      if (this.#inFlight?.done === done) this.#inFlight = null;
    });
    this.#inFlight = { key, done, controller };
    return done;
  }

  /**
   * `key` is captured by the caller before the first await: it must describe
   * what was fetched, not whatever the configuration has become since.
   *
   * Stopping is checked after every document. A stopped discovery commits
   * nothing, so it is not taken for a finished one: the next run, launch or
   * visit to the Launch page discovers again.
   */
  async #discover(key: string, signal: AbortSignal): Promise<void> {
    this.#discoveries += 1;
    // An EHR launch that names a server other than the configured one. Read
    // before the first await, like the key, so it describes this run.
    const launchedElsewhere = config.launchInfo?.overriddenFhirBaseUrl !== undefined;
    const configuredIssuer = config.current.authIssuer;
    let configuredIssuerSkipped = false;
    try {
      const docs: DiscoveryDocuments = {};
      const urls: Record<string, string> = {};

      const smart = await fetchSmartConfiguration(config.current.fhirBaseUrl, undefined, signal);
      exchangeLog.record(smart.exchange);
      if (signal.aborted) return;
      if (smart.document) {
        docs['smart-configuration'] = smart.document;
        urls['smart-configuration'] = smart.url;
      } else {
        const atRoot = await fetchSmartConfigurationAtRoot(
          config.current.fhirBaseUrl,
          undefined,
          signal
        );
        if (atRoot) {
          exchangeLog.record(atRoot.exchange);
          if (signal.aborted) return;
          if (atRoot.document) {
            docs['smart-configuration'] = atRoot.document;
            urls['smart-configuration'] = atRoot.url;
          }
        }
      }

      // Prefer the issuer the SMART document declares, since the FHIR server
      // is authoritative about which authorization server protects it.
      //
      // The configured issuer is the fallback, except for an EHR launch that
      // names another server. The configuration describes the configured
      // server and says nothing about the one the launch named. Falling back
      // there sent the launch -- its token, its `aud`, and the client secret
      // at the exchange -- to an authorization server the launch never
      // mentioned, whenever the named server could not be read. That is how a
      // launch from one EHR ended up rejected by another's scope rules.
      const declaredIssuer = docs['smart-configuration']?.issuer;
      let issuerToProbe = '';
      if (typeof declaredIssuer === 'string' && declaredIssuer) {
        issuerToProbe = declaredIssuer;
      } else if (!launchedElsewhere) {
        issuerToProbe = configuredIssuer;
      } else if (configuredIssuer) {
        configuredIssuerSkipped = true;
      }

      if (issuerToProbe) {
        const openid = await fetchOpenidConfiguration(issuerToProbe, undefined, signal);
        exchangeLog.record(openid.exchange);
        if (signal.aborted) return;
        if (openid.document) {
          docs['openid-configuration'] = openid.document;
          urls['openid-configuration'] = openid.url;
        }
      }

      const capability = await fetchCapabilityOauthUris(
        config.current.fhirBaseUrl,
        undefined,
        signal
      );
      exchangeLog.record(capability.exchange);
      if (signal.aborted) return;
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
      this.#discoveredFor = key;
      this.#configuredIssuerSkipped = configuredIssuerSkipped;
    } finally {
      this.#discoveries -= 1;
    }
  }

  /** Forgets what was discovered, so the next launch discovers again. */
  resetDiscovery(): void {
    // Including a discovery still running, or it would put back what was
    // just cleared when it finished.
    this.#inFlight?.controller.abort();
    this.#docs = {};
    this.#documentUrls = {};
    this.#endpoints = {};
    this.#conflicts = [];
    this.#gates = null;
    this.#discoveredFor = null;
    this.#configuredIssuerSkipped = false;
  }

  async run(options: { includeMutating?: boolean } = {}): Promise<void> {
    if (this.#running) return;

    this.#results = [];
    this.#stopped = false;
    const controller = new AbortController();
    this.#controller = controller;
    // From the start, discovery included: Stop has to reach every part of
    // the run. It used to be set only once discovery had finished, and the
    // signal never reached discovery at all, so Stop did nothing until every
    // document had answered or timed out -- up to a minute for a server that
    // does not answer.
    this.#running = true;
    try {
      // Raced against Stop, so the run ends at once even when it is sharing
      // a discovery the Launch page started.
      await Promise.race([this.discover(), whenAborted(controller.signal)]);
      if (controller.signal.aborted) {
        this.#stopped = true;
        return;
      }

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
              grantedScopes: session.grantedScopes?.value,
              tokenBase: session.current.configSnapshot.fhirBaseUrl,
              accessToken: session.accessToken ?? undefined,
              fhirUser:
                session.context?.fhirUser.value && session.context.fhirUser.source !== 'none'
                  ? {
                      value: session.context.fhirUser.value,
                      source: session.context.fhirUser.source
                    }
                  : undefined,
              patient: session.context?.patient.value,
              idTokenVerified: session.current.idTokenCheck?.verified
            }
          : null,
        signal: controller.signal
      };

      await runChecks(ALL_CHECKS, ctx, {
        includeMutating: options.includeMutating ?? false,
        signal: controller.signal,
        onResult: (result) => {
          // Append as they land so rows appear progressively.
          this.#results = [...this.#results, result];
          exchangeLog.recordAll(result.exchanges);
        }
      });

      // A stopped run is not a finished one: the results cover only part of
      // the configuration, so they do not become "the last run".
      if (controller.signal.aborted) {
        this.#stopped = true;
        return;
      }
      this.#ranAtFingerprint = config.fingerprint;
      this.#ranAt = Date.now();
    } finally {
      this.#running = false;
      if (this.#controller === controller) this.#controller = null;
    }
  }

  /** Stops the run, and the discovery it is waiting on, whoever started that. */
  abort(): void {
    this.#controller?.abort();
    this.#inFlight?.controller.abort();
  }

  exportMarkdown(): string {
    return toMarkdown(this.#results, { origin: config.origin });
  }
}

function whenAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/** The two values every discovery document is fetched from. */
function discoveryKey(): string {
  return JSON.stringify([config.current.fhirBaseUrl, config.current.authIssuer]);
}

export const diagnostics = new DiagnosticsStore();
