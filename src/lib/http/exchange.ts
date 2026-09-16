/**
 * A recorded HTTP request/response pair.
 *
 * Every network call Swiss makes goes through the probe and produces one of
 * these. For a diagnostic tool the raw exchange IS the deliverable -- it is
 * what you paste into a bug report when your server does something strange --
 * so this is a first-class model rather than a debug log line.
 */

export type ExchangeOutcome =
  | 'ok'
  | 'http-error'
  | 'network-or-cors'
  | 'timeout'
  | 'invalid-json'
  | 'bad-content-type'
  /** Never sent: we knew the browser would refuse it. */
  | 'blocked-precondition';

export type NetworkCause =
  | 'cors-missing-acao'
  | 'cors-preflight'
  | 'mixed-content'
  | 'dns-or-refused'
  | 'tls'
  | 'private-network'
  | 'insecure-context'
  | 'timeout'
  | 'unknown';

export interface NetworkDiagnosis {
  likelyCause: NetworkCause;
  /**
   * `certain` is reserved for preconditions we checked ourselves (mixed
   * content, insecure context). Anything inferred from a fetch rejection is
   * at best `likely`, because the browser deliberately withholds the reason.
   */
  confidence: 'certain' | 'likely' | 'guess';
  evidence: string[];
  remediationIds: string[];
}

export interface HttpExchange {
  id: string;
  label: string;
  startedAt: number;
  durationMs: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: string;
    /** `opaque` means a no-cors probe: reachable, but unreadable. */
    type: string;
    /** Headers the server did not expose to us via CORS. */
    unreadableHeaders?: string[];
  };
  outcome: ExchangeOutcome;
  diagnosis?: NetworkDiagnosis;
  /** Which fields were masked in this record. Keeps an export honest. */
  redactions: string[];
}

const SECRET_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);
const SECRET_BODY_PARAMS = [
  'client_secret',
  'code_verifier',
  'refresh_token',
  'code',
  'assertion',
  'client_assertion'
];

export const REDACTED = '«redacted»';

/**
 * Masks credentials in a copy of an exchange.
 *
 * On by default (config.redactSecrets), which is what makes "copy the
 * diagnostics report" safe to paste into a GitHub issue. The `redactions`
 * list names what was masked so the export is not silently lossy.
 */
export function redactExchange(exchange: HttpExchange): HttpExchange {
  const redactions: string[] = [];

  const headers = redactHeaders(exchange.request.headers, redactions, 'request');
  const body = exchange.request.body
    ? redactFormBody(exchange.request.body, redactions)
    : undefined;

  const response = exchange.response
    ? {
        ...exchange.response,
        headers: redactHeaders(exchange.response.headers, redactions, 'response'),
        body: exchange.response.body
          ? redactJsonBody(exchange.response.body, redactions)
          : undefined
      }
    : undefined;

  return {
    ...exchange,
    request: { ...exchange.request, headers, body },
    response,
    redactions: [...new Set([...exchange.redactions, ...redactions])]
  };
}

function redactHeaders(
  headers: Record<string, string>,
  redactions: string[],
  side: string
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SECRET_HEADERS.has(name.toLowerCase())) {
      out[name] = REDACTED;
      redactions.push(`${side} header ${name}`);
    } else {
      out[name] = value;
    }
  }
  return out;
}

function redactFormBody(body: string, redactions: string[]): string {
  // Token requests are form-encoded, so parse rather than regex.
  if (!body.includes('=')) return body;
  try {
    const params = new URLSearchParams(body);
    let touched = false;
    for (const name of SECRET_BODY_PARAMS) {
      if (params.has(name)) {
        params.set(name, REDACTED);
        redactions.push(`request body ${name}`);
        touched = true;
      }
    }
    return touched ? params.toString() : body;
  } catch {
    return body;
  }
}

function redactJsonBody(body: string, redactions: string[]): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return body;
    const obj = { ...(parsed as Record<string, unknown>) };
    let touched = false;
    // A token response carries live credentials.
    for (const name of ['access_token', 'refresh_token', 'id_token']) {
      if (typeof obj[name] === 'string') {
        obj[name] = REDACTED;
        redactions.push(`response body ${name}`);
        touched = true;
      }
    }
    return touched ? JSON.stringify(obj, null, 2) : body;
  } catch {
    return body;
  }
}

/**
 * A copy-pasteable reproduction.
 *
 * This is the single most useful affordance for a CORS failure: the browser
 * will not tell JavaScript why a request was blocked, but curl will show
 * whether Access-Control-Allow-Origin comes back.
 */
export function toCurl(exchange: HttpExchange, pageOrigin: string): string {
  const parts = [`curl -i -X ${exchange.request.method}`];
  parts.push(`  -H 'Origin: ${pageOrigin}'`);
  for (const [name, value] of Object.entries(exchange.request.headers)) {
    parts.push(`  -H '${name}: ${value}'`);
  }
  if (exchange.request.body) {
    parts.push(`  --data-raw '${exchange.request.body.replace(/'/g, "'\\''")}'`);
  }
  parts.push(`  '${exchange.request.url}'`);
  return parts.join(' \\\n');
}

export function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

/**
 * Drops entries whose id has already been seen, keeping the first (newest).
 *
 * This runs where the in-memory buffer meets the restored one, because that
 * is the only place two id namespaces can collide -- and it has to stay even
 * though `nextId` is now unique per page view. Records written by earlier
 * builds are already on disk containing repeated ids, and the drawer keys its
 * {#each} by id, so without this those users keep hitting
 * `each_key_duplicate` and the drawer keeps refusing to open until they
 * clear site storage by hand.
 */
export function dedupeById(entries: HttpExchange[]): HttpExchange[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}
