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
  blankDraft,
  cleanTabName,
  draftTitle,
  followEnvironment,
  MAX_REQUEST_TABS,
  MAX_TAB_NAME_LENGTH,
  moveTab,
  parseRequestTabs,
  serializeRequestTabs,
  tabAfterClose,
  type RequestDraft
} from './request-tabs';

const draft = (over: Partial<RequestDraft> = {}): RequestDraft => ({
  ...blankDraft('default'),
  ...over
});

describe('parseRequestTabs', () => {
  it('reads back what was written', () => {
    const tabs = [
      draft({ query: 'Patient', name: 'Search' }),
      draft({ environmentId: 'env-abcdefghij', method: 'POST', body: '{}', bodyFormat: 'xml' })
    ];
    expect(parseRequestTabs(serializeRequestTabs(tabs[1]!.id, tabs))).toEqual({
      selectedId: tabs[1]!.id,
      tabs
    });
  });

  it('is null for nothing usable', () => {
    for (const raw of [null, '', 'not json', '[]', '{"swissRequestTabsVersion":2,"tabs":[]}']) {
      expect(parseRequestTabs(raw), String(raw)).toBeNull();
    }
    expect(parseRequestTabs(serializeRequestTabs('x', []))).toBeNull();
  });

  it('drops entries it cannot trust, and repeated ids', () => {
    const good = draft();
    const raw = serializeRequestTabs(good.id, [
      good,
      { ...good },
      { ...draft(), id: '../../x' },
      { ...draft(), environmentId: '<img src=x>' },
      { ...draft(), method: 'TRACE' as never },
      { ...draft(), query: 'x'.repeat(10_000) },
      { ...draft(), body: 3 as never }
    ]);
    expect(parseRequestTabs(raw)?.tabs).toEqual([good]);
  });

  it('cleans names, defaults formats, and falls back to the first tab', () => {
    const raw = JSON.stringify({
      swissRequestTabsVersion: 1,
      selectedId: 'nope',
      tabs: [{ ...draft(), name: ' a\n\tb\u0007 ', bodyFormat: 'yaml', responseFormat: null }]
    });
    const parsed = parseRequestTabs(raw);
    expect(parsed?.tabs[0]).toMatchObject({
      name: 'a b',
      bodyFormat: 'json',
      responseFormat: 'json'
    });
    expect(parsed?.selectedId).toBe(parsed?.tabs[0]!.id);
  });

  it(`keeps at most ${MAX_REQUEST_TABS} tabs`, () => {
    const tabs = Array.from({ length: MAX_REQUEST_TABS + 5 }, () => draft());
    expect(parseRequestTabs(serializeRequestTabs(tabs[0]!.id, tabs))?.tabs).toHaveLength(
      MAX_REQUEST_TABS
    );
  });
});

describe('cleanTabName', () => {
  it(`keeps free text up to ${MAX_TAB_NAME_LENGTH} characters`, () => {
    expect(cleanTabName('Admin user, EU staging')).toBe('Admin user, EU staging');
    expect(cleanTabName('x'.repeat(100))).toHaveLength(MAX_TAB_NAME_LENGTH);
    for (const value of ['', '   ', null, 3]) expect(cleanTabName(value)).toBe('');
  });
});

describe('draftTitle', () => {
  it('uses the name, then the request', () => {
    expect(draftTitle(draft({ name: 'Mine', query: 'Patient' }))).toBe('Mine');
    expect(draftTitle(draft({ query: ' Patient?name=smith ' }))).toBe('GET Patient?name=smith');
    expect(draftTitle(draft({ method: 'POST', body: '{"resourceType":"Bundle"}' }))).toBe(
      'POST (FHIR base)'
    );
    expect(draftTitle(draft())).toBe('New request');
  });
});

describe('followEnvironment', () => {
  const a = draft({ environmentId: 'default' });
  const b = draft({ environmentId: 'env-bbbbbbbbbb' });

  it('stays when the selected tab is already on the environment', () => {
    expect(followEnvironment([a, b], a.id, 'default', false)).toEqual({ kind: 'stay' });
  });

  it('brings up a tab already on the environment', () => {
    expect(followEnvironment([a, b], a.id, b.environmentId, false)).toEqual({
      kind: 'select',
      id: b.id
    });
  });

  it('moves an untouched tab, and keeps one with a request in it', () => {
    expect(followEnvironment([a], a.id, 'env-cccccccccc', true)).toEqual({ kind: 'retarget' });
    expect(followEnvironment([a], a.id, 'env-cccccccccc', false)).toEqual({ kind: 'open' });
  });

  it('moves the selected tab at the limit', () => {
    const full = Array.from({ length: MAX_REQUEST_TABS }, () => draft());
    expect(followEnvironment(full, full[0]!.id, 'env-cccccccccc', false)).toEqual({
      kind: 'retarget'
    });
  });
});

describe('moveTab', () => {
  const [a, b, c] = [draft(), draft(), draft()];
  const ids = (tabs: RequestDraft[]) => tabs.map((t) => t.id);

  it('puts a tab before or after another', () => {
    expect(ids(moveTab([a, b, c], c.id, a.id, false))).toEqual([c.id, a.id, b.id]);
    expect(ids(moveTab([a, b, c], a.id, c.id, true))).toEqual([b.id, c.id, a.id]);
    expect(ids(moveTab([a, b, c], a.id, b.id, true))).toEqual([b.id, a.id, c.id]);
    expect(ids(moveTab([a, b, c], c.id, b.id, false))).toEqual([a.id, c.id, b.id]);
  });

  it('changes nothing for itself or a missing tab', () => {
    expect(ids(moveTab([a, b], a.id, a.id, true))).toEqual([a.id, b.id]);
    expect(ids(moveTab([a, b], 'zzzzzzzz', a.id, true))).toEqual([a.id, b.id]);
    expect(ids(moveTab([a, b], a.id, 'zzzzzzzz', true))).toEqual([a.id, b.id]);
  });
});

describe('tabAfterClose', () => {
  const [a, b, c] = [draft(), draft(), draft()];

  it('keeps the selection when another tab closes', () => {
    expect(tabAfterClose([a, b, c], c.id, a.id)).toBe(a.id);
  });

  it('selects the tab that took its place, else the one before', () => {
    expect(tabAfterClose([a, b, c], b.id, b.id)).toBe(c.id);
    expect(tabAfterClose([a, b, c], c.id, c.id)).toBe(b.id);
  });

  it('is null when the last tab closes', () => {
    expect(tabAfterClose([a], a.id, a.id)).toBeNull();
  });
});
