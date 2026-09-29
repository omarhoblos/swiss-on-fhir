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

import { describe, expect, it } from 'vitest';
import {
  buildFhirUrl,
  FhirUrlError,
  isAbsoluteUrl,
  nextPageUrl,
  patientEverythingQuery,
  patientReadQuery,
  patientWithEobQuery
} from './url';

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

  it('encodes the patient id in every quick query', () => {
    // The id comes from the token response, so a server could put `../` or
    // `?` in it and redirect the request elsewhere on its origin.
    const hostile = 'x/../Observation?_count=1#';
    for (const helper of [patientReadQuery, patientEverythingQuery, patientWithEobQuery]) {
      const query = helper(hostile);
      expect(query).not.toContain('../');
      expect(query).not.toContain('#');
    }
    expect(patientEverythingQuery('a/b')).toBe('Patient/a%2Fb/$everything');
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

describe('scheme gate', () => {
  it('refuses a query that carries its own non-http scheme', () => {
    // `new URL(relative, base)` ignores the base when the relative part has
    // a scheme, so these resolved to exactly what was typed.
    for (const query of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)'
    ]) {
      expect(() => buildFhirUrl(BASE, query), query).toThrow(FhirUrlError);
    }
  });

  it('refuses a base that is not http(s)', () => {
    expect(() => buildFhirUrl('javascript:alert(1)//', 'Patient')).toThrow(FhirUrlError);
    expect(() => buildFhirUrl('ftp://files.example/fhir', '')).toThrow(FhirUrlError);
  });

  it('reports an unparsable absolute URL as a FhirUrlError', () => {
    expect(() => buildFhirUrl(BASE, 'https://')).toThrow(FhirUrlError);
  });

  it('still allows a colon where it is data, not a scheme', () => {
    expect(buildFhirUrl(BASE, 'Patient?_lastUpdated=gt2024-01-01T00:00:00Z').toString()).toBe(
      'http://localhost:8000/Patient?_lastUpdated=gt2024-01-01T00:00:00Z'
    );
    expect(buildFhirUrl(BASE, 'Patient?identifier=urn:oid:1.2|3').pathname).toBe('/Patient');
  });
});

describe('nextPageUrl scheme gate', () => {
  const bundle = (url: unknown) => ({ resourceType: 'Bundle', link: [{ relation: 'next', url }] });

  it('keeps an http(s) link and a relative one', () => {
    expect(nextPageUrl(bundle('https://fhir.example/Patient?page=2'))).toBe(
      'https://fhir.example/Patient?page=2'
    );
    expect(nextPageUrl(bundle('Patient?page=2'))).toBe('Patient?page=2');
    expect(nextPageUrl(bundle('/baseR4?_getpages=abc'))).toBe('/baseR4?_getpages=abc');
  });

  it('drops a link with any other scheme', () => {
    for (const url of ['javascript:alert(1)', 'data:text/plain,x', ' JavaScript:alert(1)']) {
      expect(nextPageUrl(bundle(url)), url).toBeNull();
    }
  });
});
