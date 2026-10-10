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
import { MAX_VALUE_LENGTH } from '$lib/config/coerce';
import { emptyAuth } from './known-headers';
import {
  blankRow,
  CREDENTIAL_TTL_MS,
  hasCredentials,
  parseStoredRows,
  rowValue,
  serializeRows,
  wipeCredentials,
  type HeaderRow
} from './header-rows';

const NOW = 1_800_000_000_000;

function basicRow(overrides: Partial<HeaderRow> = {}): HeaderRow {
  return {
    key: 'Authorization',
    value: '',
    auth: { ...emptyAuth(), username: 'Aladdin', password: 'open sesame' },
    credentialsExpireAt: NOW + CREDENTIAL_TTL_MS,
    ...overrides
  };
}

describe('rowValue', () => {
  it('sends ordinary rows as typed and Authorization rows from their fields', () => {
    expect(rowValue({ ...blankRow(), key: 'Prefer', value: 'return=minimal' })).toBe(
      'return=minimal'
    );
    expect(rowValue(basicRow({ value: 'stale text' }))).toBe('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  });
});

describe('hasCredentials and wipeCredentials', () => {
  it('only an Authorization row holds credentials', () => {
    expect(hasCredentials(basicRow())).toBe(true);
    expect(hasCredentials({ ...basicRow(), key: 'X-Other' })).toBe(false);
    expect(hasCredentials({ ...basicRow(), auth: emptyAuth() })).toBe(false);
  });

  it('counts the raw value only in Other mode', () => {
    const other = { ...basicRow(), auth: { ...emptyAuth(), scheme: 'Other' as const } };
    expect(hasCredentials({ ...other, value: 'Digest x' })).toBe(true);
    expect(hasCredentials({ ...basicRow(), auth: emptyAuth(), value: 'Digest x' })).toBe(false);
  });

  it('keeps the name and scheme and drops everything secret', () => {
    const wiped = wipeCredentials(
      basicRow({ auth: { scheme: 'Bearer', username: 'u', password: 'p', token: 't' } })
    );
    expect(wiped).toEqual({
      key: 'Authorization',
      value: '',
      auth: { scheme: 'Bearer', username: '', password: '', token: '' },
      credentialsExpireAt: null
    });
  });
});

describe('serializeRows and parseStoredRows', () => {
  it('round-trips rows within the hour', () => {
    const rows = [{ ...blankRow(), key: 'Prefer', value: 'return=minimal' }, basicRow()];
    const { rows: back, wiped } = parseStoredRows(serializeRows(rows), NOW + 1000);
    expect(wiped).toBe(false);
    expect(back).toEqual(rows);
  });

  it('wipes credentials once they expire, and says so', () => {
    const raw = serializeRows([basicRow()]);
    const { rows, wiped } = parseStoredRows(raw, NOW + CREDENTIAL_TTL_MS);
    expect(wiped).toBe(true);
    expect(rows[0]?.key).toBe('Authorization');
    expect(rows[0]?.auth.password).toBe('');
    expect(rows[0]?.credentialsExpireAt).toBeNull();
  });

  it('pulls an expiry further than an hour away back to one', () => {
    const raw = serializeRows([basicRow({ credentialsExpireAt: NOW + 365 * 86_400_000 })]);
    expect(parseStoredRows(raw, NOW).rows[0]?.credentialsExpireAt).toBe(NOW + CREDENTIAL_TTL_MS);
  });

  it('does not store what the value box held in Basic mode', () => {
    expect(serializeRows([basicRow({ value: 'stale text' })])).not.toContain('stale text');
  });

  it('migrates an Authorization value stored before credentials expired', () => {
    const raw = JSON.stringify([
      { key: 'Authorization', value: 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==' },
      { key: 'X-Api-Key', value: 'k' }
    ]);
    const { rows } = parseStoredRows(raw, NOW);
    expect(rows[0]).toEqual({
      key: 'Authorization',
      value: '',
      auth: { scheme: 'Basic', username: 'Aladdin', password: 'open sesame', token: '' },
      credentialsExpireAt: NOW + CREDENTIAL_TTL_MS
    });
    // An API key stored before credentials expired gets the same fresh hour.
    expect(rows[1]).toEqual({
      ...blankRow(),
      key: 'X-Api-Key',
      value: 'k',
      credentialsExpireAt: NOW + CREDENTIAL_TTL_MS
    });
  });

  it('expires any header the exchange log treats as a secret, and only those', () => {
    const rows: HeaderRow[] = [
      { ...blankRow(), key: 'X-Api-Key', value: 'k', credentialsExpireAt: NOW + 1000 },
      { ...blankRow(), key: 'Prefer', value: 'return=minimal' }
    ];
    expect(hasCredentials(rows[0] as HeaderRow)).toBe(true);
    expect(hasCredentials(rows[1] as HeaderRow)).toBe(false);
    const { rows: back, wiped } = parseStoredRows(serializeRows(rows), NOW + 1000);
    expect(wiped).toBe(true);
    expect(back[0]?.value).toBe('');
    expect(back[1]?.value).toBe('return=minimal');
  });

  it('ignores storage that is not the shape it wrote', () => {
    for (const raw of [null, '', 'not json', '{}', '"a"', 'null']) {
      expect(parseStoredRows(raw, NOW)).toEqual({ rows: [], wiped: false });
    }
    const { rows } = parseStoredRows(
      JSON.stringify([
        null,
        [1],
        { key: 7, value: { x: 1 } },
        {
          key: 'Authorization',
          auth: { scheme: '__proto__', username: 5, password: 'p' },
          credentialsExpireAt: 'never'
        },
        { key: 'X-Long', value: 'a'.repeat(MAX_VALUE_LENGTH + 10) }
      ]),
      NOW
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(blankRow());
    expect(rows[1]?.auth).toEqual({ scheme: 'Basic', username: '', password: 'p', token: '' });
    expect(rows[1]?.credentialsExpireAt).toBe(NOW + CREDENTIAL_TTL_MS);
    expect(rows[2]?.value).toHaveLength(MAX_VALUE_LENGTH);
  });
});
