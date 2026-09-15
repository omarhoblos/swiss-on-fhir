import { describe, expect, it } from 'vitest';
import {
  coerceBoolean,
  coerceScopes,
  coerceString,
  coerceUrl,
  stripSurroundingQuotes
} from './coerce';

describe('coerceBoolean', () => {
  it('accepts real booleans', () => {
    expect(coerceBoolean(true)).toEqual({ ok: true, value: true });
    expect(coerceBoolean(false)).toEqual({ ok: true, value: false });
  });

  it('accepts the strings envsubst actually produces', () => {
    for (const input of ['true', 'TRUE', ' True ', '1', 'yes', 'on']) {
      expect(coerceBoolean(input), input).toEqual({ ok: true, value: true });
    }
    for (const input of ['false', 'FALSE', ' false ', '0', 'no', 'off']) {
      expect(coerceBoolean(input), input).toEqual({ ok: true, value: false });
    }
  });

  it('treats an empty string as false', () => {
    // envsubst renders an unset variable as "". For a boolean that is false,
    // not an error -- the unset-vs-empty question is settled per-field in
    // runtime.ts via emptyMeansUnset.
    expect(coerceBoolean('')).toEqual({ ok: true, value: false });
  });

  it('reports an unsubstituted placeholder instead of silently failing', () => {
    // This is the exact failure mode of the Dockerfile at v2 HEAD: the
    // envsubst step was dropped, so the app received the literal template.
    const result = coerceBoolean('${SKIP_ISSUER_CHECK}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('envsubst');
      expect(result.error).toContain('${SKIP_ISSUER_CHECK}');
    }
  });

  it('rejects a value it cannot interpret rather than defaulting to false', () => {
    // The Angular parseDotEnvBoolean returned undefined here, which is falsy,
    // so a typo silently became `false`.
    const result = coerceBoolean('maybe');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('maybe');
  });

  it('rejects non-string, non-boolean input', () => {
    expect(coerceBoolean(42).ok).toBe(false);
    expect(coerceBoolean(null).ok).toBe(false);
    expect(coerceBoolean({}).ok).toBe(false);
  });
});

describe('stripSurroundingQuotes', () => {
  it('strips symmetric quotes, which docker --env-file does not', () => {
    // The committed v2 .env had LOGOUT_URI='http://...' and --env-file is not
    // a shell, so the container saw the apostrophes as part of the value.
    expect(stripSurroundingQuotes("'http://x:9300/logout?a=b'")).toBe('http://x:9300/logout?a=b');
    expect(stripSurroundingQuotes('"http://x"')).toBe('http://x');
  });

  it('leaves asymmetric or interior quotes alone', () => {
    expect(stripSurroundingQuotes('"http://x')).toBe('"http://x');
    expect(stripSurroundingQuotes("it's fine")).toBe("it's fine");
  });
});

describe('coerceUrl', () => {
  it('normalises away a trailing slash so comparisons are stable', () => {
    expect(coerceUrl('https://ehr.example/fhir/')).toEqual({
      ok: true,
      value: 'https://ehr.example/fhir'
    });
    expect(coerceUrl('https://ehr.example/')).toEqual({ ok: true, value: 'https://ehr.example' });
  });

  it('preserves a path, since FHIR servers live at /fhir or /baseR4', () => {
    expect(coerceUrl('https://ehr.example/baseR4')).toEqual({
      ok: true,
      value: 'https://ehr.example/baseR4'
    });
  });

  it('keeps an explicit port', () => {
    expect(coerceUrl('http://localhost:8001')).toEqual({
      ok: true,
      value: 'http://localhost:8001'
    });
  });

  it('passes an empty string through for the unset case', () => {
    expect(coerceUrl('')).toEqual({ ok: true, value: '' });
  });

  it('asks for a scheme when given a bare host', () => {
    const result = coerceUrl('ehr.example');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('absolute URL');
  });

  it('rejects a non-http scheme', () => {
    expect(coerceUrl('ftp://ehr.example').ok).toBe(false);
  });

  it('rejects a base URL carrying a query or fragment', () => {
    expect(coerceUrl('https://ehr.example/fhir?x=1').ok).toBe(false);
    expect(coerceUrl('https://ehr.example/fhir#f').ok).toBe(false);
  });

  it('does NOT reject plaintext http -- that is a warning, not an error', () => {
    // Swiss has to be able to load a suspicious config in order to tell you
    // what is suspicious about it.
    expect(coerceUrl('http://internal.lan:8080/fhir').ok).toBe(true);
  });
});

describe('coerceScopes', () => {
  it('collapses irregular whitespace', () => {
    expect(coerceScopes('  openid   fhirUser \n patient/*.read ')).toEqual({
      ok: true,
      value: 'openid fhirUser patient/*.read'
    });
  });

  it('handles the * and / that SCOPES contains unquoted in .env', () => {
    expect(coerceScopes('patient/*.read patient/*.write')).toEqual({
      ok: true,
      value: 'patient/*.read patient/*.write'
    });
  });
});

describe('coerceString', () => {
  it('reports an unsubstituted placeholder', () => {
    expect(coerceString('${CLIENT_ID}').ok).toBe(false);
  });

  it('stringifies a boolean or number from a hand-edited JSON file', () => {
    expect(coerceString(false)).toEqual({ ok: true, value: 'false' });
    expect(coerceString(7)).toEqual({ ok: true, value: '7' });
  });
});
