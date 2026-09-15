/**
 * SMART scope parsing and diffing.
 *
 * The granted scope in a token response is the single most important fact on
 * the page for a permissions-testing tool, and it frequently differs from
 * what was requested. The Angular app passed scopes through as one opaque
 * string and never compared them.
 *
 * Both syntaxes are supported. SMART 1.0 uses `.read` / `.write` / `.*`;
 * SMART 2.0 uses letter sets from `cruds` plus optional search-parameter
 * constraints. The equivalence table below is load-bearing: without it, a
 * server that normalises v1 to v2 produces a page full of false "scope was
 * dropped" alarms.
 */

export type FhirOperation = 'c' | 'r' | 'u' | 'd' | 's';

export interface FhirScope {
  kind: 'fhir';
  context: 'patient' | 'user' | 'system';
  /** A resource type, or `*` for all. */
  resource: string;
  ops: Set<FhirOperation>;
  /** Set when parsed from SMART 1.0 syntax. */
  v1Legacy?: 'read' | 'write' | '*';
  /** SMART 2.0 search-parameter constraints. */
  params?: Record<string, string>;
  raw: string;
}

export type Scope =
  | FhirScope
  | { kind: 'launch'; target?: 'patient' | 'encounter'; raw: string }
  | {
      kind: 'openid' | 'fhirUser' | 'profile' | 'offline_access' | 'online_access';
      raw: string;
    }
  | { kind: 'unknown'; raw: string };

const OPS_BY_V1: Record<string, FhirOperation[]> = {
  // v1 `.write` covers create, update and delete.
  read: ['r', 's'],
  write: ['c', 'u', 'd'],
  '*': ['c', 'r', 'u', 'd', 's']
};

export function parseScope(raw: string): Scope {
  const scope = raw.trim();
  if (!scope) return { kind: 'unknown', raw };

  switch (scope) {
    case 'openid':
    case 'fhirUser':
    case 'profile':
    case 'offline_access':
    case 'online_access':
      return { kind: scope, raw: scope };
    case 'launch':
      return { kind: 'launch', raw: scope };
    case 'launch/patient':
      return { kind: 'launch', target: 'patient', raw: scope };
    case 'launch/encounter':
      return { kind: 'launch', target: 'encounter', raw: scope };
  }

  // patient/Observation.rs?category=laboratory
  const match = /^(patient|user|system)\/([A-Za-z*]+)\.([A-Za-z*]+)(\?.*)?$/.exec(scope);
  if (!match) return { kind: 'unknown', raw: scope };

  const [, context, resource, operations, query] = match;

  const params: Record<string, string> | undefined = query
    ? Object.fromEntries(new URLSearchParams(query.slice(1)).entries())
    : undefined;

  const v1 = OPS_BY_V1[operations ?? ''];
  if (v1) {
    return {
      kind: 'fhir',
      context: context as FhirScope['context'],
      resource: resource ?? '*',
      ops: new Set(v1),
      v1Legacy: operations as FhirScope['v1Legacy'],
      params,
      raw: scope
    };
  }

  // SMART 2.0: a set of letters from `cruds`.
  if (/^[cruds]+$/.test(operations ?? '')) {
    return {
      kind: 'fhir',
      context: context as FhirScope['context'],
      resource: resource ?? '*',
      ops: new Set((operations ?? '').split('') as FhirOperation[]),
      params,
      raw: scope
    };
  }

  return { kind: 'unknown', raw: scope };
}

export function parseScopes(spaceDelimited: string): Scope[] {
  return spaceDelimited.split(/\s+/).filter(Boolean).map(parseScope);
}

export function formatScope(scope: Scope): string {
  return scope.raw;
}

function sameOps(a: Set<FhirOperation>, b: Set<FhirOperation>): boolean {
  if (a.size !== b.size) return false;
  for (const op of a) if (!b.has(op)) return false;
  return true;
}

function sameParams(a?: Record<string, string>, b?: Record<string, string>): boolean {
  const ak = Object.keys(a ?? {});
  const bk = Object.keys(b ?? {});
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a?.[k] === b?.[k]);
}

/** True when two scopes grant the same thing, across syntax versions. */
export function scopeEquivalent(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'fhir' || b.kind !== 'fhir') return a.raw === b.raw;
  return (
    a.context === b.context &&
    a.resource === b.resource &&
    sameOps(a.ops, b.ops) &&
    sameParams(a.params, b.params)
  );
}

/** True when `granted` is a strict subset of what `requested` allowed. */
function isNarrowing(requested: FhirScope, granted: FhirScope): boolean {
  if (requested.context !== granted.context) return false;

  const resourceNarrowed = requested.resource === '*' && granted.resource !== '*';
  const sameResource = requested.resource === granted.resource;
  if (!resourceNarrowed && !sameResource) return false;

  const opsNarrowed = [...granted.ops].every((op) => requested.ops.has(op));
  const paramsAdded = !sameParams(requested.params, granted.params);

  return (resourceNarrowed || granted.ops.size < requested.ops.size || paramsAdded) && opsNarrowed;
}

export interface ScopeDiff {
  requested: Scope[];
  granted: Scope[];
  /** Requested and not granted in any form. A real reduction. */
  dropped: Scope[];
  /** Granted without being requested. */
  added: Scope[];
  /** Same meaning, different syntax. Cosmetic -- not a reduction. */
  normalized: { from: Scope; to: Scope }[];
  /** Genuinely reduced permission. */
  narrowed: { from: Scope; to: Scope }[];
  /** Requested but absent from the server's advertised list. */
  unsupportedByServer: Scope[];
  unchanged: Scope[];
}

export function diffScopes(
  requestedRaw: string,
  grantedRaw: string | undefined,
  scopesSupported: string[] | null = null
): ScopeDiff {
  const requested = parseScopes(requestedRaw);
  const granted = parseScopes(grantedRaw ?? '');

  const dropped: Scope[] = [];
  const normalized: { from: Scope; to: Scope }[] = [];
  const narrowed: { from: Scope; to: Scope }[] = [];
  const unchanged: Scope[] = [];
  const matchedGranted = new Set<Scope>();

  for (const want of requested) {
    const exact = granted.find((g) => g.raw === want.raw && !matchedGranted.has(g));
    if (exact) {
      matchedGranted.add(exact);
      unchanged.push(want);
      continue;
    }

    // Same permission, different spelling: v1 -> v2 normalisation. Reporting
    // this as "dropped" would be actively misleading.
    const equivalent = granted.find((g) => scopeEquivalent(want, g) && !matchedGranted.has(g));
    if (equivalent) {
      matchedGranted.add(equivalent);
      normalized.push({ from: want, to: equivalent });
      continue;
    }

    if (want.kind === 'fhir') {
      const narrower = granted.find(
        (g) => g.kind === 'fhir' && !matchedGranted.has(g) && isNarrowing(want, g)
      );
      if (narrower) {
        matchedGranted.add(narrower);
        narrowed.push({ from: want, to: narrower });
        continue;
      }
    }

    dropped.push(want);
  }

  const added = granted.filter((g) => !matchedGranted.has(g));

  const unsupportedByServer =
    scopesSupported === null ? [] : requested.filter((s) => !scopesSupported.includes(s.raw));

  return {
    requested,
    granted,
    dropped,
    added,
    normalized,
    narrowed,
    unsupportedByServer,
    unchanged
  };
}

/** Whether the diff represents a real loss of permission. */
export function hasRealReduction(diff: ScopeDiff): boolean {
  return diff.dropped.length > 0 || diff.narrowed.length > 0;
}
