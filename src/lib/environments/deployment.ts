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

import { calculateJwkThumbprint } from 'jose';
import type { ConfigLayer } from '#lib/config/types.ts';
import { importPrivateKey } from '#lib/oidc/key-import.ts';
import { loadKeyPair, storeKeyPair } from '#lib/oidc/keys.ts';
import {
  MAX_ENVIRONMENTS_FILE_LENGTH,
  parseEnvironmentsFile,
  type PrivateKeyInput
} from './format';
import { isEnvironmentId } from './types';

/**
 * Environments shipped with the deployment.
 *
 * An operator can put an environments file -- the same format the Config
 * page exports -- at /swiss-environments.json, and every visitor sees its
 * environments, read-only, beside Default. Edits made in the browser layer
 * on top of them, as they do over .env for Default.
 *
 * The file is optional, and missing is the usual case. A 404 means none,
 * and so does a 200 with an HTML page: the development server, the e2e
 * preview and any nginx without Swiss's own location serve the app's shell
 * for a file that is not there. Only a file that is there and wrong is
 * reported, on the Config page.
 *
 * Root-level, like /swiss-env.json: a served directory would shadow a route.
 */
export const DEPLOYMENT_ENVIRONMENTS_PATH = '/swiss-environments.json';

export interface DeploymentEnvironment {
  /** Always `deploy:<id>`. */
  id: string;
  name: string;
  layer: ConfigLayer;
  key?: PrivateKeyInput;
}

export interface DeploymentLoadResult {
  /** Whether a file was there at all. */
  present: boolean;
  environments: DeploymentEnvironment[];
  /** The environment a first-time visitor starts in, as a `deploy:` id. */
  defaultEnvironment?: string;
  /** Problems with the file or its entries, shown on the Config page. */
  issues: string[];
}

const NONE: DeploymentLoadResult = { present: false, environments: [], issues: [] };

/** An id from a name: lowercase letters, digits and dashes. */
export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
}

/** Reads the deployment's environments file, or says there is none. */
export async function loadDeploymentEnvironments(
  fetchImpl: typeof fetch = fetch,
  path: string = DEPLOYMENT_ENVIRONMENTS_PATH
): Promise<DeploymentLoadResult> {
  let response: Response;
  try {
    // no-store, as for swiss-env.json: an edited file must apply on reload.
    response = await fetchImpl(path, { cache: 'no-store' });
  } catch {
    return NONE;
  }
  if (response.status === 404) return NONE;
  if (!response.ok) {
    return {
      ...NONE,
      issues: [`${path} returned HTTP ${response.status}, so its environments were not loaded.`]
    };
  }
  const type = response.headers?.get('content-type') ?? '';
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ...NONE, issues: [`${path} could not be read.`] };
  }
  if (type.includes('text/html') || /^\s*</.test(text)) return NONE;
  if (text.length > MAX_ENVIRONMENTS_FILE_LENGTH) {
    return {
      present: true,
      environments: [],
      issues: [
        `${path} is ${text.length} characters long; the limit is ${MAX_ENVIRONMENTS_FILE_LENGTH}.`
      ]
    };
  }

  const parsed = parseEnvironmentsFile(text);
  if (parsed.kind === 'invalid') {
    return { present: true, environments: [], issues: [`${path}: ${parsed.error}`] };
  }
  if (parsed.kind === 'single') {
    return {
      present: true,
      environments: [],
      issues: [
        `${path} holds a single configuration. A deployment file lists environments: { "swissEnvironmentsVersion": 1, "environments": [ ... ] }. For one configuration, use .env.`
      ]
    };
  }

  const issues = [...parsed.notes.map((note) => `${path}: ${note}`)];
  const environments: DeploymentEnvironment[] = [];
  const fileIdToId = new Map<string, string>();
  for (const env of parsed.environments) {
    const label = `“${env.name}” in ${path}`;
    if (env.errors.length > 0) {
      issues.push(`${label} was not loaded: ${env.errors.join(' ')}`);
      continue;
    }
    const id = `deploy:${env.id ?? (slugOf(env.name) || `environment-${env.position}`)}`;
    if (!isEnvironmentId(id) || environments.some((e) => e.id === id)) {
      issues.push(
        `${label} was not loaded: its id \`${id}\` ${isEnvironmentId(id) ? 'is already used by an earlier entry' : 'is not usable'}. Give it an "id".`
      );
      continue;
    }
    for (const note of env.notes) issues.push(`${label}: ${note}`);
    environments.push({ id, name: env.name, layer: env.layer, key: env.key });
    if (env.id) fileIdToId.set(env.id, id);
  }

  return {
    present: true,
    environments,
    defaultEnvironment: parsed.defaultEnvironment
      ? fileIdToId.get(parsed.defaultEnvironment)
      : undefined,
    issues
  };
}

async function thumbprintOf(publicKey: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  return calculateJwkThumbprint(jwk as Parameters<typeof calculateJwkThumbprint>[0]);
}

/**
 * Puts each deployment environment's key in its Backend Services slot,
 * non-extractable. A key is replaced only when the file's key is a
 * different one (by thumbprint), and never when the user imported or
 * generated their own for that environment. Returns problems to report.
 */
export async function syncDeploymentKeys(environments: DeploymentEnvironment[]): Promise<string[]> {
  const issues: string[] = [];
  for (const env of environments) {
    if (!env.key) continue;
    const result = await importPrivateKey(env.key);
    if (!result.ok) {
      issues.push(`The Backend Services key of “${env.name}” could not be used: ${result.error}`);
      continue;
    }
    try {
      const held = await loadKeyPair(env.id);
      if (held && held.source !== 'deployment') continue;
      if (held && (await thumbprintOf(held.publicKey)) === (await thumbprintOf(result.publicKey))) {
        continue;
      }
      await storeKeyPair(env.id, result, 'deployment');
    } catch (cause) {
      issues.push(
        `The Backend Services key of “${env.name}” could not be stored: ${cause instanceof Error ? cause.message : String(cause)}`
      );
    }
  }
  return issues;
}
