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

import { MAX_VALUE_LENGTH } from '$lib/config/coerce';
import { isSecretHeader } from '$lib/http/exchange';
import {
  AUTH_SCHEMES,
  authorizationValue,
  emptyAuth,
  isAuthorization,
  parseAuthorization,
  type AuthFields,
  type AuthScheme
} from './known-headers';

/**
 * The FHIR console's header rows, and how they are kept in localStorage.
 *
 * Credentials -- an Authorization row's, or the value of a header named like
 * a key, token, secret or password, the same test the exchange log redacts
 * by -- are stored only for an hour after they were last changed, then wiped
 * from storage and from the form. Everything else in a row is stored as
 * before, for as long as the user asks.
 */

export const CREDENTIAL_TTL_MS = 60 * 60 * 1000;

export interface HeaderRow {
  key: string;
  /** What is sent, except for an Authorization row in Basic or Bearer mode. */
  value: string;
  /** Only meaningful on an Authorization row. */
  auth: AuthFields;
  /** When stored credentials are wiped; null when none are stored. */
  credentialsExpireAt: number | null;
}

export function blankRow(): HeaderRow {
  return { key: '', value: '', auth: emptyAuth(), credentialsExpireAt: null };
}

/** The value this row sends. */
export function rowValue(row: HeaderRow): string {
  return isAuthorization(row.key) ? authorizationValue(row.auth, row.value) : row.value;
}

/** Whether the row holds credentials that storing would keep. */
export function hasCredentials(row: HeaderRow): boolean {
  if (!isAuthorization(row.key)) return isSecretHeader(row.key) && row.value !== '';
  const { scheme, username, password, token } = row.auth;
  return Boolean(username || password || token || (scheme === 'Other' && row.value));
}

/** The row without its credentials. The header name and scheme are kept. */
export function wipeCredentials<T extends HeaderRow>(row: T): T {
  return {
    ...row,
    value: '',
    auth: { ...row.auth, username: '', password: '', token: '' },
    credentialsExpireAt: null
  };
}

export function serializeRows(rows: readonly HeaderRow[]): string {
  return JSON.stringify(
    rows.map((row) =>
      isAuthorization(row.key)
        ? {
            key: row.key,
            // In Basic or Bearer mode the value box is not shown, so what
            // it last held is not stored either.
            value: row.auth.scheme === 'Other' ? row.value : '',
            auth: { ...row.auth },
            credentialsExpireAt: row.credentialsExpireAt
          }
        : isSecretHeader(row.key)
          ? { key: row.key, value: row.value, credentialsExpireAt: row.credentialsExpireAt }
          : { key: row.key, value: row.value }
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_VALUE_LENGTH) : '';
}

function scheme(value: unknown): AuthScheme {
  return AUTH_SCHEMES.find((s) => s === value) ?? 'Basic';
}

function readRow(stored: Record<string, unknown>): HeaderRow {
  const key = text(stored.key);
  const value = text(stored.value);
  if (!isAuthorization(key)) return { ...blankRow(), key, value };

  const auth: AuthFields = isRecord(stored.auth)
    ? {
        scheme: scheme(stored.auth.scheme),
        username: text(stored.auth.username),
        password: text(stored.auth.password),
        token: text(stored.auth.token)
      }
    : parseAuthorization(value);
  return { key, value: auth.scheme === 'Other' ? value : '', auth, credentialsExpireAt: null };
}

/**
 * Reads stored rows back. Storage is input: anything that is not the shape
 * written above is dropped or blanked. Credentials past their expiry are
 * wiped, and `wiped` says so, so the form can tell the user why they are
 * gone. An expiry further away than an hour is pulled back to one, so a
 * hand-edited entry cannot keep a password forever.
 *
 * Rows stored before credentials expired kept the Authorization value as
 * typed, and an API key with no expiry at all; those are read back and
 * given a fresh hour.
 */
export function parseStoredRows(
  raw: string | null,
  now: number
): { rows: HeaderRow[]; wiped: boolean } {
  if (!raw) return { rows: [], wiped: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { rows: [], wiped: false };
  }
  if (!Array.isArray(parsed)) return { rows: [], wiped: false };

  let wiped = false;
  const rows = parsed.filter(isRecord).map((stored): HeaderRow => {
    const row = readRow(stored);
    if (!hasCredentials(row)) return row;

    const latest = now + CREDENTIAL_TTL_MS;
    const at = stored.credentialsExpireAt;
    const expireAt = typeof at === 'number' && Number.isFinite(at) ? Math.min(at, latest) : latest;
    if (expireAt <= now) {
      wiped = true;
      return wipeCredentials(row);
    }
    return { ...row, credentialsExpireAt: expireAt };
  });
  return { rows, wiped };
}
