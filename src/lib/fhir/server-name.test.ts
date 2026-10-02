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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => vi.fn());
vi.mock('$lib/http/probe', () => ({ probe }));
vi.mock('$lib/http/log.svelte', () => ({ exchangeLog: { record: vi.fn() } }));

import {
  fhirBaseOf,
  readServerName,
  requestBaseOf,
  requestTitle,
  serverNameFrom
} from './server-name';

describe('serverNameFrom', () => {
  it('uses the software name and version over the title', () => {
    expect(
      serverNameFrom({
        resourceType: 'CapabilityStatement',
        title: 'Acme Clinical Data',
        software: { name: 'Acme FHIR', version: '7.4.0' }
      })
    ).toBe('Acme FHIR 7.4.0');
    expect(
      serverNameFrom({
        title: 'Firely Server 6.10.0+85497ec CapabilityStatement',
        software: { name: 'Firely Server', version: '6.10.0+85497ec' }
      })
    ).toBe('Firely Server 6.10.0+85497ec');
    expect(serverNameFrom({ title: 'Acme Clinical Data', software: { name: 'Acme FHIR' } })).toBe(
      'Acme FHIR'
    );
  });

  it('falls back to the title without a software name', () => {
    expect(serverNameFrom({ title: 'Acme Clinical Data' })).toBe('Acme Clinical Data');
    // A version on its own is not a software name.
    expect(serverNameFrom({ title: 'Acme Clinical Data', software: { version: '7.4.0' } })).toBe(
      'Acme Clinical Data'
    );
  });

  it('names nothing without a software name or a title', () => {
    expect(serverNameFrom({ software: { version: '7.4.0' } })).toBeNull();
    expect(serverNameFrom({ resourceType: 'CapabilityStatement' })).toBeNull();
    expect(serverNameFrom({ title: '   ', software: { name: '' } })).toBeNull();
    expect(serverNameFrom(null)).toBeNull();
    expect(serverNameFrom('Acme')).toBeNull();
  });

  it('treats server text as input', () => {
    expect(serverNameFrom({ title: 42, software: { name: ['Acme'] } })).toBeNull();
    expect(serverNameFrom({ title: '  Acme\n\tClinical   Data ' })).toBe('Acme Clinical Data');
    const long = serverNameFrom({ software: { name: 'x'.repeat(500) } })!;
    expect(long).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('requestTitle', () => {
  it('names the server, or is just Request', () => {
    expect(requestTitle('Acme FHIR 7.4.0')).toBe('Request to server: Acme FHIR 7.4.0');
    expect(requestTitle(null)).toBe('Request');
  });
});

describe('fhirBaseOf', () => {
  it('cuts the URL at the resource type, operation or metadata', () => {
    expect(fhirBaseOf('https://server.fire.ly/r4/Patient')).toBe('https://server.fire.ly/r4');
    expect(fhirBaseOf('https://server.fire.ly/r4/Patient/1/_history/2')).toBe(
      'https://server.fire.ly/r4'
    );
    expect(fhirBaseOf('https://hapi.test/baseR4/Patient?name=x')).toBe('https://hapi.test/baseR4');
    expect(fhirBaseOf('https://a.test/fhir/$export')).toBe('https://a.test/fhir');
    expect(fhirBaseOf('https://a.test/fhir/_search')).toBe('https://a.test/fhir');
    expect(fhirBaseOf('https://a.test/fhir/metadata')).toBe('https://a.test/fhir');
    expect(fhirBaseOf('http://localhost:8000/Patient')).toBe('http://localhost:8000');
    expect(fhirBaseOf('https://a.test/fhir/')).toBe('https://a.test/fhir');
  });

  it('is null for anything but an http(s) URL', () => {
    expect(fhirBaseOf('Patient/1')).toBeNull();
    expect(fhirBaseOf('javascript:alert(1)')).toBeNull();
    expect(fhirBaseOf('ftp://a.test/fhir')).toBeNull();
  });
});

describe('requestBaseOf', () => {
  const base = 'http://localhost:8000';

  it('is the configured base for a relative path or a URL under it', () => {
    expect(requestBaseOf('Patient?_id=patient-a', base)).toBe(base);
    expect(requestBaseOf('', base)).toBe(base);
    expect(requestBaseOf('http://localhost:8000/Patient', base)).toBe(base);
    expect(requestBaseOf('http://localhost:8000', base)).toBe(base);
    expect(requestBaseOf('https://a.test/fhir/Patient', 'https://a.test/fhir/')).toBe(
      'https://a.test/fhir/'
    );
  });

  it("is the typed URL's own base for another server", () => {
    expect(requestBaseOf('https://server.fire.ly/r4/Patient', base)).toBe(
      'https://server.fire.ly/r4'
    );
    // Same host, another port, or a path that only starts the same, is another server.
    expect(requestBaseOf('http://localhost:8001/Patient', base)).toBe('http://localhost:8001');
    expect(requestBaseOf('https://a.test/fhir2/Patient', 'https://a.test/fhir')).toBe(
      'https://a.test/fhir2'
    );
  });
});

describe('readServerName', () => {
  const answer = (json: unknown, status = 200) => ({
    exchange: { request: { url: '' }, response: { status }, durationMs: 1 },
    json,
    text: JSON.stringify(json)
  });

  beforeEach(() => probe.mockReset());

  it('asks the base for a summary of its CapabilityStatement', async () => {
    probe.mockResolvedValue(answer({ software: { name: 'Acme FHIR' } }));
    const name = await readServerName({
      base: 'https://a.test/fhir',
      tokenBase: 'https://a.test/fhir',
      accessToken: null,
      signal: new AbortController().signal
    });
    expect(name).toBe('Acme FHIR');
    expect(probe.mock.calls[0]![0]).toBe('https://a.test/fhir/metadata?_summary=true');
  });

  it('sends the token to the base it was issued for', async () => {
    probe.mockResolvedValue(answer({ title: 'B' }));
    await readServerName({
      base: 'https://b.test/fhir',
      tokenBase: 'https://b.test/fhir',
      accessToken: 'access-1',
      signal: new AbortController().signal
    });
    expect(probe.mock.calls[0]![1].headers.Authorization).toBe('Bearer access-1');
  });

  it('asks another server without the token', async () => {
    probe.mockResolvedValue(answer({ title: 'Other' }));
    const name = await readServerName({
      base: 'https://server.fire.ly/r4',
      tokenBase: 'https://b.test/fhir',
      accessToken: 'access-1',
      signal: new AbortController().signal
    });
    expect(name).toBe('Other');
    expect(probe.mock.calls[0]![0]).toBe('https://server.fire.ly/r4/metadata?_summary=true');
    expect(probe.mock.calls[0]![1].headers.Authorization).toBeUndefined();
  });

  it('remembers an answer, but asks again after a failure', async () => {
    probe.mockResolvedValue(answer({ title: 'C' }));
    const signal = new AbortController().signal;
    expect(
      await readServerName({
        base: 'https://c.test',
        tokenBase: 'https://c.test',
        accessToken: null,
        signal: signal
      })
    ).toBe('C');
    expect(
      await readServerName({
        base: 'https://c.test',
        tokenBase: 'https://c.test',
        accessToken: null,
        signal: signal
      })
    ).toBe('C');
    expect(probe).toHaveBeenCalledTimes(1);

    probe.mockResolvedValue(answer({ issue: [] }, 503));
    expect(
      await readServerName({
        base: 'https://d.test',
        tokenBase: 'https://d.test',
        accessToken: null,
        signal: signal
      })
    ).toBeNull();
    probe.mockResolvedValue(answer({ title: 'D' }));
    expect(
      await readServerName({
        base: 'https://d.test',
        tokenBase: 'https://d.test',
        accessToken: null,
        signal: signal
      })
    ).toBe('D');
  });
});
