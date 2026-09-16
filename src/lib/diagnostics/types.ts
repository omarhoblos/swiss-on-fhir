import type { AppConfig } from '$lib/config/types';
import type { HttpExchange } from '$lib/http/exchange';
import type { DiscoveryDocuments } from '$lib/smart/discovery';
import type { ResolvedEndpoints, SmartFeatureGates } from '$lib/smart/types';

export type CheckStatus =
  | 'pass'
  | 'warn'
  | 'fail'
  /** A dependency failed, so this could not be evaluated. */
  | 'skip'
  /** Cannot be checked from a browser, or needs an explicit click. */
  | 'manual'
  | 'running';

export type CheckGroup =
  'environment' | 'discovery' | 'capabilities' | 'cors' | 'flow' | 'permissions';

export interface RemediationAction {
  kind: 'set-config' | 'copy' | 'open-url';
  label: string;
  /** For `set-config`. */
  patch?: Partial<AppConfig>;
  /** For `copy` and `open-url`. */
  value?: string;
}

export interface Remediation {
  id: string;
  label: string;
  body: string;
  actions?: RemediationAction[];
}

export interface CheckResult {
  id: string;
  title: string;
  group: CheckGroup;
  status: CheckStatus;
  /** One line, plain language, no jargon. */
  summary: string;
  detail?: string;
  remediations: Remediation[];
  /** The raw traffic for this check, so a finding can be verified. */
  exchanges: HttpExchange[];
  durationMs: number;
  spec?: { name: string; section?: string; url: string };
}

/**
 * What the checks are allowed to know about a live session.
 *
 * Deliberately a few facts rather than the session object: it keeps each
 * check's dependency visible and testable, and stops the diagnostics layer
 * reaching into auth internals.
 */
export interface DiagnosticsSession {
  /** A refresh token actually in hand, which is proof the grant works. */
  hasRefreshToken: boolean;
  /**
   * True when the config has moved since these tokens were issued, so the
   * evidence may describe a different server than the one being checked.
   */
  staleConfig: boolean;
  /** What the server actually granted, which may differ from what was asked. */
  grantedScopes?: string;
}

export interface DiagnosticsContext {
  config: AppConfig;
  origin: string | null;
  endpoints: ResolvedEndpoints;
  docs: DiscoveryDocuments;
  gates: SmartFeatureGates | null;
  /** Discovery URLs that actually answered, which is itself diagnostic. */
  documentUrls: Partial<Record<string, string>>;
  /** Null when there is no session; checks that need one then skip. */
  session: DiagnosticsSession | null;
  fetchImpl?: typeof fetch;
}

export interface Check {
  id: string;
  title: string;
  group: CheckGroup;
  /** If any of these failed, this check is skipped with the reason named. */
  dependsOn?: string[];
  /** Requires an explicit click (it changes state on the server). */
  mutating?: boolean;
  run(ctx: DiagnosticsContext): Promise<Omit<CheckResult, 'id' | 'title' | 'group' | 'durationMs'>>;
}

export function result(
  partial: Partial<Omit<CheckResult, 'id' | 'title' | 'group' | 'durationMs'>> & {
    status: CheckStatus;
    summary: string;
  }
): Omit<CheckResult, 'id' | 'title' | 'group' | 'durationMs'> {
  return {
    status: partial.status,
    summary: partial.summary,
    detail: partial.detail,
    remediations: partial.remediations ?? [],
    exchanges: partial.exchanges ?? [],
    spec: partial.spec
  };
}
