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
import { deleteKeyPair } from '#lib/oidc/keys.ts';
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
