import { describe, expect, it } from 'vitest';
import { buildFhirUrl, FhirUrlError, isAbsoluteUrl, nextPageUrl } from './url';

const BASE = 'http://localhost:8000';
const BASE_WITH_PATH = 'https://ehr.example/baseR4';

describe('buildFhirUrl', () => {
  it('resolves a relative query against the base', () => {
    expect(buildFhirUrl(BASE, 'Patient').toString()).toBe('http://localhost:8000/Patient');
  });

  it('accepts a leading slash without dropping a base path', () => {
    // A bare `new URL('/Patient', base)` would reset to the origin and lose
    // /baseR4, which is how FHIR servers are commonly deployed.
    expect(buildFhirUrl(BASE_WITH_PATH, '/Patient').toString()).toBe(
      'https://ehr.example/baseR4/Patient'
    );
    expect(buildFhirUrl(BASE_WITH_PATH, 'Patient').toString()).toBe(
      'https://ehr.example/baseR4/Patient'
    );
  });

  it('tolerates a trailing slash on the base', () => {
    expect(buildFhirUrl('http://localhost:8000/', 'Patient').toString()).toBe(
      'http://localhost:8000/Patient'
    );
  });

  it('preserves a query string', () => {
    expect(buildFhirUrl(BASE, 'Patient?_id=patient-a&_count=5').toString()).toBe(
      'http://localhost:8000/Patient?_id=patient-a&_count=5'
    );
  });

  it('passes an absolute URL through unchanged', () => {
    expect(buildFhirUrl(BASE, 'https://other.example/fhir/Patient').toString()).toBe(
      'https://other.example/fhir/Patient'
    );
  });

  it('treats a digit-leading query as relative, not absolute', () => {
    // The Angular version matched /^\d/ and used such a query verbatim, which
    // was almost certainly accidental -- "123" is not a URL.
    expect(buildFhirUrl(BASE, '123').toString()).toBe('http://localhost:8000/123');
  });

  it('treats a path that merely starts with "http" as relative', () => {
    // The old check was startsWith('http'), which matched this too.
    expect(buildFhirUrl(BASE, 'httpbin/Patient').toString()).toBe(
      'http://localhost:8000/httpbin/Patient'
    );
  });

  it('handles an operation path', () => {
    expect(buildFhirUrl(BASE, 'Patient/patient-a/$everything').toString()).toBe(
      'http://localhost:8000/Patient/patient-a/$everything'
    );
  });

  it('resolves an empty query to the base, for a Bundle POST', () => {
    expect(buildFhirUrl('https://fhir.example/baseR4/', '   ').toString()).toBe(
      'https://fhir.example/baseR4'
    );
  });

  it('rejects an empty query with no base configured', () => {
    expect(() => buildFhirUrl('', '')).toThrow(FhirUrlError);
  });

  it('rejects a relative query with no base configured', () => {
    expect(() => buildFhirUrl('', 'Patient')).toThrow(/No FHIR base/);
  });
});

describe('isAbsoluteUrl', () => {
  it('requires a real scheme separator', () => {
    expect(isAbsoluteUrl('https://x/y')).toBe(true);
    expect(isAbsoluteUrl('http://x')).toBe(true);
    expect(isAbsoluteUrl('httpbin/Patient')).toBe(false);
    expect(isAbsoluteUrl('Patient')).toBe(false);
  });
});

describe('nextPageUrl', () => {
  it('finds the next link in a Bundle', () => {
    expect(
      nextPageUrl({
        resourceType: 'Bundle',
        link: [
          { relation: 'self', url: 'http://x/Patient' },
          { relation: 'next', url: 'http://x/Patient?page=2' }
        ]
      })
    ).toBe('http://x/Patient?page=2');
  });

  it('returns null when there is no next link', () => {
    expect(
      nextPageUrl({ resourceType: 'Bundle', link: [{ relation: 'self', url: 'http://x' }] })
    ).toBeNull();
    expect(nextPageUrl({ resourceType: 'Bundle' })).toBeNull();
    expect(nextPageUrl(null)).toBeNull();
  });
});
