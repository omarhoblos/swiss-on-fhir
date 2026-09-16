/**
 * Where to look for a JWK Set.
 *
 * The advertised `jwks_uri` is always tried first and is the only correct
 * answer, but servers spell the path both ways -- `/jwks` and `/jwks.json`
 * are both in the wild -- and plenty of deployments either omit `jwks_uri`
 * or advertise one that does not resolve. Since the JWKS is what makes ID
 * token verification possible at all, it is worth a few extra guesses and
 * then saying plainly which URL actually answered.
 */

/** Tried under the issuer when there is nothing better to go on. */
const ISSUER_SUFFIXES = ['/.well-known/jwks.json', '/jwks', '/jwks.json'];

function httpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const { protocol } = new URL(value);
    // Returns the original string: the parse is a validity and scheme gate,
    // and `new URL()` would normalise a value the server has to match.
    return protocol === 'https:' || protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * The other spelling of the same endpoint.
 *
 * `/jwks` and `/jwks.json` are the two conventions in practice, so a server
 * that advertises one and serves the other is a one-line miss rather than a
 * missing feature.
 */
function otherSpelling(url: string): string | null {
  const [path, rest] = splitQuery(url);
  if (path.endsWith('/jwks.json')) return `${path.slice(0, -'.json'.length)}${rest}`;
  if (path.endsWith('/jwks')) return `${path}.json${rest}`;
  return null;
}

function splitQuery(url: string): [string, string] {
  const cut = url.search(/[?#]/);
  return cut === -1 ? [url, ''] : [url.slice(0, cut), url.slice(cut)];
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Candidate JWKS URLs in the order they should be tried, most authoritative
 * first. Duplicates are collapsed so the same URL is never probed twice.
 */
export function jwksCandidates(
  advertised: string | undefined,
  issuer: string | undefined
): string[] {
  const out: string[] = [];
  const add = (value: string | null) => {
    if (value && !out.includes(value)) out.push(value);
  };

  const primary = httpUrl(advertised);
  add(primary);
  if (primary) add(otherSpelling(primary));

  const base = httpUrl(issuer)?.replace(/\/+$/, '');
  if (base) for (const suffix of ISSUER_SUFFIXES) add(`${base}${suffix}`);

  return out;
}
