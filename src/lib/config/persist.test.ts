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
  ACTIVE_ENVIRONMENT_KEY,
  ENVIRONMENT_INDEX_KEY,
  LAST_ACTIVE_ENVIRONMENT_KEY,
  LEGACY_OVERRIDES_KEY,
  LEGACY_SECRET_PERSISTED_KEY,
  LEGACY_SECRET_SESSION_KEY,
  MAX_ENVIRONMENTS,
  clearAllOverrides,
  loadActiveEnvironmentId,
  loadEnvironmentIndex,
  loadOverrides,
  migrateLegacyKeys,
  overridesKey,
  saveActiveEnvironmentId,
  saveEnvironmentIndex,
  saveOverrides,
  saveSecret,
  secretPersistedKey,
  secretSessionKey
} from './persist';

let local: MemoryStorage;
let session: MemoryStorage;

beforeEach(() => {
  ({ local, session } = stubStorages());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('migrateLegacyKeys', () => {
  it('moves the 3.1 overrides and secrets into the Default environment', () => {
    local.setItem(LEGACY_OVERRIDES_KEY, JSON.stringify({ clientId: 'old-client' }));
    session.setItem(LEGACY_SECRET_SESSION_KEY, 'tab-secret');
    local.setItem(LEGACY_SECRET_PERSISTED_KEY, 'disk-secret');

    migrateLegacyKeys();

    expect(local.getItem(LEGACY_OVERRIDES_KEY)).toBeNull();
    expect(session.getItem(LEGACY_SECRET_SESSION_KEY)).toBeNull();
    expect(local.getItem(LEGACY_SECRET_PERSISTED_KEY)).toBeNull();
    const { layer, secretIsPersisted } = loadOverrides('default');
    expect(layer.clientId).toBe('old-client');
    // The tab's own secret wins over the remembered one, as before.
    expect(layer.clientSecret).toBe('tab-secret');
    expect(secretIsPersisted).toBe(true);
  });

  it('keeps a newer value already in place and still removes the old key', () => {
    local.setItem(overridesKey('default'), JSON.stringify({ clientId: 'newer' }));
    local.setItem(LEGACY_OVERRIDES_KEY, JSON.stringify({ clientId: 'older' }));

    migrateLegacyKeys();

    expect(loadOverrides('default').layer.clientId).toBe('newer');
    expect(local.getItem(LEGACY_OVERRIDES_KEY)).toBeNull();
  });

  it('is safe to run on every load', () => {
    local.setItem(LEGACY_OVERRIDES_KEY, JSON.stringify({ scopes: 'openid' }));
    migrateLegacyKeys();
    migrateLegacyKeys();
    expect(loadOverrides('default').layer.scopes).toBe('openid');
  });

  it('migrates a tab that still has its session secret after another tab migrated the rest', () => {
    local.setItem(overridesKey('default'), JSON.stringify({ clientId: 'migrated' }));
    session.setItem(LEGACY_SECRET_SESSION_KEY, 'this-tab');
    migrateLegacyKeys();
    expect(session.getItem(secretSessionKey('default'))).toBe('this-tab');
  });
});

describe('per-environment overrides', () => {
  it('keeps each environment apart', () => {
    saveOverrides('default', { clientId: 'a' });
    saveOverrides('env-staging01', { clientId: 'b', scopes: 'openid' });

    expect(loadOverrides('default').layer).toEqual({ clientId: 'a' });
    expect(loadOverrides('env-staging01').layer).toEqual({ clientId: 'b', scopes: 'openid' });
  });

  it('re-validates what it reads back through the field parsers', () => {
    local.setItem(
      overridesKey('default'),
      JSON.stringify({
        tokenStorage: 'floppy-disk',
        clientId: 'ok',
        unknownKey: 1,
        clientSecret: 'never-from-here'
      })
    );
    const { layer } = loadOverrides('default');
    expect(layer).toEqual({ clientId: 'ok' });
  });

  it('drops a corrupt record instead of failing', () => {
    local.setItem(overridesKey('default'), '{not json');
    expect(loadOverrides('default').layer).toEqual({});
    expect(local.getItem(overridesKey('default'))).toBeNull();
  });

  it('never writes the secret with the other overrides', () => {
    saveOverrides('default', { clientId: 'a', clientSecret: 's3cret' });
    expect(local.getItem(overridesKey('default'))).toBe(JSON.stringify({ clientId: 'a' }));
  });

  it('removes the record when nothing is overridden', () => {
    saveOverrides('default', { clientId: 'a' });
    saveOverrides('default', {});
    expect(local.getItem(overridesKey('default'))).toBeNull();
  });
});

describe('per-environment secrets', () => {
  it('keeps the secret in this tab unless persisting was chosen, per environment', () => {
    saveSecret('default', 'tab-only', false);
    saveSecret('env-staging01', 'remembered', true);

    expect(session.getItem(secretSessionKey('default'))).toBe('tab-only');
    expect(local.getItem(secretPersistedKey('default'))).toBeNull();
    expect(local.getItem(secretPersistedKey('env-staging01'))).toBe('remembered');
    expect(loadOverrides('env-staging01').layer.clientSecret).toBe('remembered');
    expect(loadOverrides('env-staging01').secretIsPersisted).toBe(true);
  });

  it('moves the secret when the choice changes, and an empty secret clears both', () => {
    saveSecret('default', 'x', true);
    saveSecret('default', 'x', false);
    expect(local.getItem(secretPersistedKey('default'))).toBeNull();
    expect(session.getItem(secretSessionKey('default'))).toBe('x');

    saveSecret('default', '', false);
    expect(session.getItem(secretSessionKey('default'))).toBeNull();
  });

  it('clearAllOverrides clears one environment only', () => {
    saveOverrides('default', { clientId: 'a' });
    saveSecret('default', 's', false);
    saveOverrides('env-other00', { clientId: 'b' });

    clearAllOverrides('default');

    expect(loadOverrides('default').layer).toEqual({});
    expect(loadOverrides('env-other00').layer).toEqual({ clientId: 'b' });
  });
});

describe('active environment', () => {
  it("prefers this tab's choice, then the last one chosen anywhere", () => {
    local.setItem(LAST_ACTIVE_ENVIRONMENT_KEY, 'env-elsewhere');
    expect(loadActiveEnvironmentId()).toBe('env-elsewhere');

    session.setItem(ACTIVE_ENVIRONMENT_KEY, 'env-thistab0');
    expect(loadActiveEnvironmentId()).toBe('env-thistab0');
  });

  it('ignores a stored value that is not an id', () => {
    session.setItem(ACTIVE_ENVIRONMENT_KEY, '../../etc');
    local.setItem(LAST_ACTIVE_ENVIRONMENT_KEY, 'default');
    expect(loadActiveEnvironmentId()).toBe('default');
  });

  it('saves to both places', () => {
    saveActiveEnvironmentId('env-chosen00');
    expect(session.getItem(ACTIVE_ENVIRONMENT_KEY)).toBe('env-chosen00');
    expect(local.getItem(LAST_ACTIVE_ENVIRONMENT_KEY)).toBe('env-chosen00');
  });
});

describe('environment index', () => {
  it('round-trips', () => {
    saveEnvironmentIndex([{ id: 'env-a00000000', name: 'Staging' }]);
    expect(loadEnvironmentIndex()).toEqual([{ id: 'env-a00000000', name: 'Staging' }]);
  });

  it('skips malformed, reserved and repeated entries, and cleans names', () => {
    local.setItem(
      ENVIRONMENT_INDEX_KEY,
      JSON.stringify([
        { id: 'env-good', name: '  Good\nname ' },
        { id: 'env-good', name: 'Duplicate' },
        { id: 'default', name: 'Reserved' },
        { id: 'deploy:x', name: 'Not from the browser' },
        { id: 'BAD ID', name: 'x' },
        { id: 'env-noname', name: '   ' },
        'not an object',
        null
      ])
    );
    expect(loadEnvironmentIndex()).toEqual([{ id: 'env-good', name: 'Good name' }]);
  });

  it('caps how many it reads', () => {
    local.setItem(
      ENVIRONMENT_INDEX_KEY,
      JSON.stringify(
        Array.from({ length: MAX_ENVIRONMENTS + 20 }, (_, i) => ({ id: `env-${i}`, name: `E${i}` }))
      )
    );
    expect(loadEnvironmentIndex()).toHaveLength(MAX_ENVIRONMENTS);
  });

  it('returns nothing for a record that is not a list', () => {
    local.setItem(ENVIRONMENT_INDEX_KEY, JSON.stringify({ id: 'env-a' }));
    expect(loadEnvironmentIndex()).toEqual([]);
    local.setItem(ENVIRONMENT_INDEX_KEY, '{broken');
    expect(loadEnvironmentIndex()).toEqual([]);
  });
});
