import {
  headersToObject,
  type ExchangeOutcome,
  type HttpExchange,
  type NetworkCause,
  type NetworkDiagnosis
} from './exchange';

/**
 * The single instrumented network path.
 *
 * Every request Swiss makes goes through here so that (a) it is recorded as
 * an HttpExchange, and (b) a failure gets diagnosed rather than surfacing as
 * a bare "TypeError: Failed to fetch".
 *
 * The diagnosis matters more than it might seem. When a cross-origin request
 * is blocked, the browser gives JavaScript *nothing* -- same opaque TypeError
 * for a CORS failure, a dead host, and a bad certificate. The real message is
 * printed to the devtools console and is unreachable from script. Since CORS
 * is the most common failure for this tool, we infer what we can and, where
 * we cannot, hand the user something that will tell them (open in a new tab,
 * or a curl command).
 */

export interface ProbeOptions {
  label: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Where the page itself is served from, for precondition checks. */
  pageOrigin?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface ProbeResult {
  exchange: HttpExchange;
  /** Parsed JSON, when the response was JSON. */
  json?: unknown;
  text?: string;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `x${counter.toString(36)}`;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isPrivateHost(hostname: string): boolean {
  return (
    isLoopbackHost(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

/**
 * Checks we can make before sending. These are the only diagnoses that can
 * be `certain`, because we are not guessing at a browser's reasons -- we are
 * applying a rule the browser will apply.
 */
export function checkPreconditions(
  url: string,
  pageOrigin: string | null
): NetworkDiagnosis | null {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }

  if (typeof globalThis.isSecureContext === 'boolean' && !globalThis.isSecureContext) {
    // Worth reporting even for a plain fetch: it also means crypto.subtle is
    // unavailable, so PKCE S256 cannot work at all.
    return {
      likelyCause: 'insecure-context',
      confidence: 'certain',
      evidence: [
        `The page is not a secure context (${pageOrigin ?? 'unknown origin'}).`,
        'crypto.subtle is unavailable, so PKCE S256 cannot be used.'
      ],
      remediationIds: ['insecure-context-no-crypto']
    };
  }

  if (pageOrigin?.startsWith('https://') && target.protocol === 'http:') {
    if (!isLoopbackHost(target.hostname)) {
      return {
        likelyCause: 'mixed-content',
        confidence: 'certain',
        evidence: [
          `The page is served over HTTPS (${pageOrigin}) but the target is plaintext http (${target.origin}).`,
          'The browser blocks this as mixed content before the request is sent.'
        ],
        remediationIds: ['mixed-content']
      };
    }
  }

  return null;
}

export async function probe(url: string, options: ProbeOptions): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const method = options.method ?? 'GET';
  const headers = options.headers ?? {};
  const pageOrigin =
    options.pageOrigin ?? (typeof location === 'undefined' ? null : location.origin);
  const timeoutMs = options.timeoutMs ?? 15_000;

  const exchange: HttpExchange = {
    id: nextId(),
    label: options.label,
    startedAt: Date.now(),
    durationMs: 0,
    request: { method, url, headers, body: options.body },
    outcome: 'ok',
    redactions: []
  };

  // Do not send something we know will be refused; the resulting error would
  // be indistinguishable from a dozen other causes.
  const precondition = checkPreconditions(url, pageOrigin);
  if (precondition && precondition.likelyCause === 'mixed-content') {
    exchange.outcome = 'blocked-precondition';
    exchange.diagnosis = precondition;
    return { exchange };
  }

  const started = performance.now();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: options.body,
      signal: options.signal ?? AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit'
    });
  } catch (cause) {
    exchange.durationMs = Math.round(performance.now() - started);
    const isTimeout = cause instanceof DOMException && cause.name === 'TimeoutError';
    exchange.outcome = isTimeout ? 'timeout' : 'network-or-cors';
    exchange.diagnosis = isTimeout
      ? {
          likelyCause: 'timeout',
          confidence: 'certain',
          evidence: [`No response within ${timeoutMs}ms.`],
          remediationIds: []
        }
      : await diagnoseFetchFailure(url, options, pageOrigin, fetchImpl);
    return { exchange };
  }

  exchange.durationMs = Math.round(performance.now() - started);
  exchange.response = {
    status: response.status,
    statusText: response.statusText,
    headers: headersToObject(response.headers),
    type: response.type,
    unreadableHeaders: unreadableHeaders(response)
  };

  const text = await response.text().catch(() => '');
  exchange.response.body = text;

  if (!response.ok) exchange.outcome = 'http-error';

  const contentType = response.headers.get('content-type') ?? '';
  const looksJson = text.trimStart().startsWith('{') || text.trimStart().startsWith('[');

  if (looksJson) {
    try {
      const json: unknown = JSON.parse(text);
      // A wrong Content-Type is common on .well-known documents. Parse
      // anyway and note it, rather than refusing usable data.
      if (!/json/i.test(contentType) && response.ok) {
        exchange.outcome = 'bad-content-type';
      }
      return { exchange, json, text };
    } catch {
      exchange.outcome = 'invalid-json';
      return { exchange, text };
    }
  }

  if (/json/i.test(contentType) && text.trim() !== '') {
    exchange.outcome = 'invalid-json';
  }

  return { exchange, text };
}

/**
 * Headers a server sent but did not expose to us.
 *
 * Worth reporting explicitly: without Access-Control-Expose-Headers we
 * cannot read WWW-Authenticate or Location, and silently showing them as
 * absent would be misleading.
 */
function unreadableHeaders(response: Response): string[] | undefined {
  if (response.type === 'opaque') return undefined;
  const interesting = ['www-authenticate', 'location', 'retry-after'];
  const missing = interesting.filter((h) => !response.headers.has(h));
  // We cannot actually distinguish "not sent" from "not exposed", so only
  // mention this where it would change the interpretation.
  return missing.length > 0 && response.status >= 300 ? missing : undefined;
}

/**
 * Infers why a fetch rejected, using a second no-cors probe.
 *
 * If the no-cors request resolves, the server answered and the browser simply
 * would not let us read it -- which means CORS, not connectivity. If it also
 * rejects, the connection never completed.
 */
async function diagnoseFetchFailure(
  url: string,
  options: ProbeOptions,
  pageOrigin: string | null,
  fetchImpl: typeof fetch
): Promise<NetworkDiagnosis> {
  const evidence = [
    'The browser deliberately withholds the reason for a blocked cross-origin request from JavaScript.',
    'The actual message is printed in the devtools Console, and only there.'
  ];

  let target: URL | null = null;
  try {
    target = new URL(url);
  } catch {
    /* keep going with what we have */
  }

  // An opaque response that resolves means the server answered and the
  // browser simply would not expose it to us -- which is the only way, from
  // script, to tell a CORS problem apart from a connectivity one.
  let reachable = false;
  try {
    await fetchImpl(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit'
    });
    reachable = true;
  } catch {
    // Leave it false: the connection itself never completed.
  }

  let likelyCause: NetworkCause;
  const remediationIds: string[] = [];

  if (reachable) {
    evidence.unshift(
      'A no-cors probe to the same URL succeeded, so the server is reachable and did respond -- the browser just refused to expose the response to this page.'
    );
    // A request carrying non-simple headers is preflighted; a bare GET is
    // not. If the bare probe worked, the difference is the preflight.
    const hadNonSimpleHeaders = Object.keys(options.headers ?? {}).some(
      (h) => !['accept', 'accept-language', 'content-language'].includes(h.toLowerCase())
    );
    if (hadNonSimpleHeaders) {
      likelyCause = 'cors-preflight';
      evidence.push(
        `The failing request carried ${Object.keys(options.headers ?? {}).join(', ')}, which forces a CORS preflight. The server must answer OPTIONS without authentication and list those headers in Access-Control-Allow-Headers.`
      );
      remediationIds.push('cors-preflight-authorization');
    } else {
      likelyCause = 'cors-missing-acao';
      evidence.push(
        'The server is most likely not sending Access-Control-Allow-Origin for this page’s origin.'
      );
      remediationIds.push('cors-missing-acao');
    }
  } else if (target?.protocol === 'https:') {
    likelyCause = 'tls';
    evidence.unshift(
      'A no-cors probe also failed, so the connection never completed. For an HTTPS target this is usually a certificate problem, a wrong port, or nothing listening.'
    );
    evidence.push(
      'A bad certificate is indistinguishable from a dead host here. Opening the URL in a new tab will show the browser’s own certificate warning if that is the cause.'
    );
    remediationIds.push('tls-or-unreachable');
  } else {
    likelyCause = 'dns-or-refused';
    evidence.unshift(
      'A no-cors probe also failed, so the connection never completed: DNS did not resolve, nothing is listening on that port, or the host refused the connection.'
    );
    remediationIds.push('tls-or-unreachable');
  }

  if (pageOrigin?.startsWith('https://') && target && isPrivateHost(target.hostname)) {
    evidence.push(
      'The target is a private or loopback address and this page is HTTPS, so Chrome also applies Private Network Access, which can block the request independently of CORS.'
    );
    remediationIds.push('private-network');
  }

  return { likelyCause, confidence: 'likely', evidence, remediationIds };
}

/** Convenience wrapper for the common "fetch a JSON document" case. */
export async function probeJson(
  url: string,
  options: ProbeOptions
): Promise<ProbeResult & { ok: boolean }> {
  const result = await probe(url, options);
  const ok: ExchangeOutcome[] = ['ok', 'bad-content-type'];
  return { ...result, ok: ok.includes(result.exchange.outcome) && result.json !== undefined };
}
