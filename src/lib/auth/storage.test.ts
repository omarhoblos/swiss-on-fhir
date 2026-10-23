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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubStorages, type MemoryStorage } from '#lib/testing/storage.ts';
import {
  ACTIVE_SLOT_KEY,
  LEGACY_SESSION_KEY,
  createSessionStore,
  isPersistedSession,
  loadActiveSlot,
  migrateLegacySession,
  saveActiveSlot,
  sessionKey,
  storedLaunchTypes,
  type PersistedSession
} from './storage';

/**
 * `load()` itself needs browser storage and is covered by the e2e specs,
 * which seed a session and would fail if a valid one were rejected. What is
 * tested here is the decision it makes.
 */
function validSession(): Record<string, unknown> {
  return {
    tokens: { access_token: 'access-1', token_type: 'Bearer' },
    context: {
      patient: { source: 'none' },
      encounter: { source: 'none' },
      fhirUser: { source: 'none' },
      extras: {}
    },
    obtainedAt: 1_700_000_000_000,
    expiresAt: null,
    requestedScopes: 'openid',
    intent: { flavor: 'standalone' },
    configSnapshot: { fhirBaseUrl: 'https://fhir.test' }
  };
}

describe('isPersistedSession', () => {
  it('accepts what save() writes', () => {
    expect(isPersistedSession(validSession())).toBe(true);
    expect(isPersistedSession({ ...validSession(), expiresAt: 1_700_000_360_000 })).toBe(true);
    // Round-tripped, as it is when read back.
    expect(isPersistedSession(JSON.parse(JSON.stringify(validSession())))).toBe(true);
  });

  it('rejects values that are not a record at all', () => {
    for (const value of [null, undefined, 'session', 42, true, [], [validSession()]]) {
      expect(isPersistedSession(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('rejects a record missing a field the Session page reads unconditionally', () => {
    for (const key of Object.keys(validSession())) {
      const broken = validSession();
      delete broken[key];
      expect(isPersistedSession(broken), `without ${key}`).toBe(false);
    }
  });

  it('rejects fields of the wrong type', () => {
    const cases: Record<string, unknown>[] = [
      { tokens: 'x' },
      { tokens: {} },
      { tokens: { access_token: 42 } },
      { context: null },
      // Each of these took the Session page down with a 500 on every load.
      { context: { extras: {} } },
      { context: { patient: {}, encounter: {}, fhirUser: null, extras: {} } },
      { context: { patient: {}, encounter: {}, fhirUser: {} } },
      { obtainedAt: '1700000000000' },
      { expiresAt: 'never' },
      { requestedScopes: ['openid'] },
      { intent: { flavor: 1 } },
      { configSnapshot: [] }
    ];
    for (const patch of cases) {
      expect(isPersistedSession({ ...validSession(), ...patch }), JSON.stringify(patch)).toBe(
        false
      );
    }
  });

  it('refuses token fields of the wrong type, which the Session page reads directly', () => {
    for (const [key, value] of [
      ['refresh_token', 123],
      ['token_type', 1],
      ['id_token', null],
      ['scope', ['a']],
      ['expires_in', '3600']
    ] as const) {
      const session = validSession();
      session.tokens = { ...(session.tokens as object), [key]: value };
      expect(isPersistedSession(session), key).toBe(false);
    }
  });
});

describe('session slots', () => {
  let local: MemoryStorage;
  let session: MemoryStorage;

  beforeEach(() => {
    ({ local, session } = stubStorages());
  });

  afterEach(() => {
    // Memory-mode sessions live in the module; clear what a test left there.
    for (const envId of ['default', 'env-other00']) {
      for (const launchType of ['standalone', 'ehr', 'backend-services'] as const) {
        createSessionStore('memory', envId, launchType).clear();
      }
    }
    vi.unstubAllGlobals();
  });

  const tokens = (access: string) =>
    ({ ...validSession(), tokens: { access_token: access } }) as unknown as PersistedSession;

  it('keeps each environment and launch type in its own slot', () => {
    createSessionStore('session', 'default', 'standalone').save(tokens('std'));
    createSessionStore('session', 'default', 'backend-services').save(tokens('bs'));
    createSessionStore('session', 'env-other00', 'standalone').save(tokens('other'));

    expect(createSessionStore('session', 'default', 'standalone').load()?.tokens.access_token).toBe(
      'std'
    );
    expect(
      createSessionStore('session', 'default', 'backend-services').load()?.tokens.access_token
    ).toBe('bs');
    expect(storedLaunchTypes('default')).toEqual(['standalone', 'backend-services']);
    expect(storedLaunchTypes('env-other00')).toEqual(['standalone']);
  });

  it('keeps a slot in one place: saving removes copies elsewhere', () => {
    createSessionStore('local', 'default', 'standalone').save(tokens('one'));
    createSessionStore('session', 'default', 'standalone').save(tokens('two'));
    expect(local.getItem(sessionKey('default', 'standalone'))).toBeNull();
    expect(session.getItem(sessionKey('default', 'standalone'))).not.toBeNull();
  });

  it('moves a session found in another place to the configured one when loading', () => {
    createSessionStore('session', 'default', 'standalone').save(tokens('moved'));

    const loaded = createSessionStore('local', 'default', 'standalone').load();

    expect(loaded?.tokens.access_token).toBe('moved');
    expect(session.getItem(sessionKey('default', 'standalone'))).toBeNull();
    expect(local.getItem(sessionKey('default', 'standalone'))).not.toBeNull();
  });

  it('takes a session off disk when the setting becomes memory-only', () => {
    createSessionStore('local', 'default', 'standalone').save(tokens('mem'));

    const loaded = createSessionStore('memory', 'default', 'standalone').load();

    expect(loaded?.tokens.access_token).toBe('mem');
    expect(local.getItem(sessionKey('default', 'standalone'))).toBeNull();
    expect(createSessionStore('memory', 'default', 'standalone').load()).not.toBeNull();
  });

  it('clears a slot everywhere and leaves the others', () => {
    createSessionStore('session', 'default', 'standalone').save(tokens('a'));
    createSessionStore('session', 'default', 'ehr').save(tokens('b'));
    createSessionStore('local', 'default', 'standalone').clear();
    expect(storedLaunchTypes('default')).toEqual(['ehr']);
  });

  it('drops a stored record that is not a session', () => {
    session.setItem(sessionKey('default', 'standalone'), '{"tokens":"no"}');
    expect(createSessionStore('session', 'default', 'standalone').load()).toBeNull();
    expect(session.getItem(sessionKey('default', 'standalone'))).toBeNull();
  });
});

describe('migrateLegacySession', () => {
  let local: MemoryStorage;
  let session: MemoryStorage;

  beforeEach(() => {
    ({ local, session } = stubStorages());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("moves the 3.1 session into Default's slot for its flavor", () => {
    session.setItem(
      LEGACY_SESSION_KEY,
      JSON.stringify({ ...validSession(), intent: { flavor: 'backend-services' } })
    );

    migrateLegacySession();

    expect(session.getItem(LEGACY_SESSION_KEY)).toBeNull();
    expect(session.getItem(sessionKey('default', 'backend-services'))).not.toBeNull();
  });

  it('looks in localStorage too, and keeps a newer session already in the slot', () => {
    local.setItem(sessionKey('default', 'standalone'), JSON.stringify(validSession()));
    local.setItem(
      LEGACY_SESSION_KEY,
      JSON.stringify({ ...validSession(), tokens: { access_token: 'older' } })
    );

    migrateLegacySession();

    expect(local.getItem(LEGACY_SESSION_KEY)).toBeNull();
    expect(JSON.parse(local.getItem(sessionKey('default', 'standalone')) ?? '{}')).toEqual(
      validSession()
    );
  });

  it('discards an old record that is not a session', () => {
    session.setItem(LEGACY_SESSION_KEY, '{"tokens":"not-an-object"}');
    migrateLegacySession();
    expect(session.getItem(LEGACY_SESSION_KEY)).toBeNull();
    expect(session.length).toBe(0);
  });
});

describe('active slot', () => {
  let session: MemoryStorage;

  beforeEach(() => {
    ({ session } = stubStorages());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('remembers a slot per environment in this tab', () => {
    saveActiveSlot('default', 'ehr');
    saveActiveSlot('env-other00', 'backend-services');
    expect(loadActiveSlot('default')).toBe('ehr');
    expect(loadActiveSlot('env-other00')).toBe('backend-services');
    expect(loadActiveSlot('env-unknown0')).toBeNull();
  });

  it('ignores entries that are not an id and a launch type', () => {
    session.setItem(
      ACTIVE_SLOT_KEY,
      JSON.stringify({ default: 'nonsense', 'BAD ID': 'ehr', 'env-ok': 'ehr' })
    );
    expect(loadActiveSlot('default')).toBeNull();
    expect(loadActiveSlot('env-ok')).toBe('ehr');
  });
});
