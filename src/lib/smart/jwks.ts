import { httpUrl } from '$lib/url';

/**
 * Where to look for a JWK Set.
 *
 * An advertised `jwks_uri` is the only correct answer, but there is usually
 * more than one of them: the endpoint table keeps a single winner per key by
 * precedence, and smart-configuration outranks openid-configuration. A real
 * Smile CDR deployment advertises `/.well-known/jwks.json` in
 * smart-configuration, which redirects and holds no keys, and `/jwk` in
 * openid-configuration, which is the one that works -- so the correct value is
 * discovered and then discarded.
 *
 * Every advertised value is therefore tried before anything is guessed, in
 * precedence order. Only then does Swiss fall back to the two spellings
 * servers actually use, and finally to paths under the issuer.
 */

/** Guessed under the issuer, last, when nothing advertised answered. */
const ISSUER_SUFFIXES = ['/jwk', '/jwk.json', '/.well-known/jwks.json'];

/**
 * The same path with `.json` added or removed.
 *
 * Stem-agnostic on purpose: it turns `/jwk` into `/jwk.json` and
 * `/.well-known/jwks.json` into `/.well-known/jwks` without needing to know
 * which spelling the server chose.
 */
function jsonSuffixToggled(url: string): string | null {
  const [path, query] = splitQuery(url);
  if (path.endsWith('.json')) return `${path.slice(0, -'.json'.length)}${query}`;
  if (path.endsWith('/')) return null;
  return `${path}.json${query}`;
}

function splitQuery(url: string): [string, string] {
  const cut = url.search(/[?#]/);
  return cut === -1 ? [url, ''] : [url.slice(0, cut), url.slice(cut)];
}

/**
 * Candidate JWKS URLs in the order they should be tried, most authoritative
 * first. Duplicates are collapsed so the same URL is never probed twice.
 *
 * @param advertised every `jwks_uri` any discovery document supplied, highest
 * precedence first. A real value from an outranked document beats any guess.
 */
export function jwksCandidates(
  advertised: readonly (string | undefined)[],
  issuer: string | undefined
): string[] {
  const out: string[] = [];
  const add = (value: string | null) => {
    if (value && !out.includes(value)) out.push(value);
  };

  const real = advertised.map(httpUrl).filter((value): value is string => value !== null);
  for (const value of real) add(value);
  for (const value of real) add(jsonSuffixToggled(value));

  const base = httpUrl(issuer)?.replace(/\/+$/, '');
  if (base) for (const suffix of ISSUER_SUFFIXES) add(`${base}${suffix}`);

  return out;
}
