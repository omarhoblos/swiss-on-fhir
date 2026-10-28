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

import { removeEnvironmentSessions } from '#lib/auth/storage.ts';
import { config } from '#lib/config/config.svelte.ts';
import { savedHeadersKey } from '#lib/http/headers.ts';
import { importPrivateKey } from '#lib/oidc/key-import.ts';
import { deleteKeyPair, exportPublicJwks, storeKeyPair } from '#lib/oidc/keys.ts';
import { serializeEnvironments, type ParsedEnvironment } from './format';
import { switchEnvironment } from './switch';
import { DEFAULT_ENVIRONMENT_ID } from './types';

/**
 * Deletes an environment made in this browser, with everything stored for
 * it: settings, client secret, its sessions in every launch type and storage
 * place, its Backend Services key and the FHIR console's saved headers. A
 * tab using it switches to Default first.
 *
 * Tokens are discarded locally, not revoked: the server is not told. The
 * caller says so before asking.
 */
export async function deleteEnvironment(envId: string): Promise<boolean> {
  const env = config.environmentById(envId);
  if (!env || env.origin !== 'browser') return false;
  if (config.activeEnvironmentId === envId) switchEnvironment(DEFAULT_ENVIRONMENT_ID);
  if (!config.removeEnvironment(envId)) return false;
  removeEnvironmentSessions(envId);
  try {
    localStorage.removeItem(savedHeadersKey(envId));
  } catch {
    /* nothing stored */
  }
  await deleteKeyPair(envId);
  return true;
}

export interface ImportOutcome {
  imported: { name: string; replaced: boolean; key: boolean }[];
  refused: { name: string; errors: string[] }[];
  /** Imported, but the private key it carried could not be used. */
  keyProblems: { name: string; error: string }[];
}

/**
 * Imports the chosen environments from a parsed file, each whole or not at
 * all, and brings any private key they carry into their Backend Services
 * slot. A key that cannot be used does not undo its environment: the
 * settings are imported and the key problem is reported beside them.
 */
export async function importEnvironments(
  environments: ParsedEnvironment[],
  options: { mode: 'copy' | 'replace' }
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { imported: [], refused: [], keyProblems: [] };
  for (const env of environments) {
    if (env.errors.length > 0) {
      outcome.refused.push({ name: env.name, errors: env.errors });
      continue;
    }
    const { id, name, replaced } = config.importEnvironment(env.name, env.layer, options.mode);
    let key = false;
    if (env.key) {
      const result = await importPrivateKey(env.key);
      if (result.ok) {
        await storeKeyPair(id, result, 'imported');
        key = true;
      } else {
        outcome.keyProblems.push({ name, error: result.error });
      }
    }
    outcome.imported.push({ name, replaced, key });
  }
  return outcome;
}

/**
 * Every environment, as the environments file: effective values, the
 * client secret only when asked for, and each Backend Services key's public
 * JWKS for reference. Never a private key; Swiss cannot read one back.
 */
export async function exportEnvironments(options: { includeSecret: boolean }): Promise<string> {
  const entries = await Promise.all(
    config.environments.map(async (env) => ({
      id: env.id,
      name: env.name,
      origin: env.origin,
      config: config.effectiveFor(env.id) ?? config.base,
      publicJwks: (await exportPublicJwks(env.id)) ?? undefined
    }))
  );
  return serializeEnvironments(entries, options);
}
