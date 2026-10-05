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
import { searchJson } from './search';

const bundle = {
  resourceType: 'Bundle',
  entry: [
    { resource: { resourceType: 'Patient', id: 'patient-a', name: [{ family: 'Smith' }] } },
    { resource: { resourceType: 'Observation', id: 'obs-1', status: 'final' } }
  ]
};

describe('searchJson', () => {
  it('finds a value, ignoring case, and keeps the path to it', () => {
    const { hits, paths } = searchJson(bundle, 'smith');
    expect([...hits]).toEqual(['$.entry[0].resource.name[0].family']);
    expect([...paths].sort()).toEqual(
      [
        '$',
        '$.entry',
        '$.entry[0]',
        '$.entry[0].resource',
        '$.entry[0].resource.name',
        '$.entry[0].resource.name[0]',
        '$.entry[0].resource.name[0].family'
      ].sort()
    );
  });

  it('finds an object key', () => {
    const { hits } = searchJson(bundle, 'STATUS');
    expect([...hits]).toEqual(['$.entry[1].resource.status']);
  });

  it('does not treat array indices as keys', () => {
    expect(searchJson(bundle, '1').hits).toEqual(new Set(['$.entry[1].resource.id']));
  });

  it('matches numbers, booleans and null by their text', () => {
    const { hits } = searchJson({ total: 42, active: true, end: null }, 'tru');
    expect([...hits]).toEqual(['$.active']);
    expect([...searchJson({ end: null }, 'null').hits]).toEqual(['$.end']);
    expect([...searchJson({ total: 42 }, '42').hits]).toEqual(['$.total']);
  });

  it('finds nothing for an empty or blank query', () => {
    expect(searchJson(bundle, '   ').paths.size).toBe(0);
  });

  it('finds nothing when nothing matches', () => {
    const { hits, paths } = searchJson(bundle, 'zzqx');
    expect(hits.size).toBe(0);
    expect(paths.size).toBe(0);
  });
});
