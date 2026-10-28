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

import { settingsFromDotEnv } from '#lib/config/dotenv.ts';
import { FIELDS } from '#lib/config/fields.ts';
import { parseRuntimeObject } from '#lib/config/runtime.ts';
import type { AppConfig, ConfigLayer } from '#lib/config/types.ts';
import { MAX_ENVIRONMENTS } from '#lib/config/persist.ts';
import { isEnvironmentId, sanitizeName, type EnvironmentOrigin } from './types';

/**
 * The environments file: what Swiss exports, what it imports, and what a
 * deployment can ship.
 *
 *   {
 *     "swissEnvironmentsVersion": 1,
 *     "defaultEnvironment": "staging",          optional, deployment file only
 *     "environments": [
 *       { "id": "staging", "name": "Staging",
 *         "settings": { "fhirBaseUrl": "...", "clientId": "...", ... },
 *         "backendServicesKey": { ...private JWK... } or "-----BEGIN PRIVATE KEY-----...",
 *         "publicJwks": { "keys": [...] } }     written by an export, ignored on import
 *     ]
 *   }
 *
 * An export always lists every environment, as an array, even when there is
 * only one. Settings are read by the same parser as /swiss-env.json, so
 * aliases, removed keys and the unset-versus-empty rules behave the same.
 * Swiss never writes a private key (it cannot read one back), but a file
 * prepared by hand may carry one for an environment's Backend Services.
 *
 * Everything in a file is input: sizes and counts are capped, names cleaned,
 * ids checked, and an environment with a setting that does not parse is
 * refused as a whole, so a half-applied environment never exists.
 */

export const ENVIRONMENTS_FORMAT_VERSION = 1;
/** A thousand environments with long scopes stay well under this. */
export const MAX_ENVIRONMENTS_FILE_LENGTH = 1_000_000;
/** A PEM RSA-4096 key is about 3.3 kB. */
export const MAX_KEY_INPUT_LENGTH = 16_384;
/** Stands for a client secret left out of an export. Skipped on import. */
export const OMITTED = '<omitted>';

export type PrivateKeyInput = { kind: 'jwk'; jwk: JsonWebKey } | { kind: 'pem'; pem: string };

export interface ParsedEnvironment {
  /** Its position in the file, from 1, for messages. */
  position: number;
  /** As written in the file. Only a deployment file's ids are used. */
  id?: string;
  name: string;
  layer: ConfigLayer;
  /** Any of these, and the environment is not imported. */
  errors: string[];
  /** Worth knowing; nothing was refused. */
  notes: string[];
  key?: PrivateKeyInput;
}

export type ParsedFile =
  | {
      kind: 'environments';
      environments: ParsedEnvironment[];
      defaultEnvironment?: string;
      notes: string[];
    }
  /** A 3.1 export, or a bare settings object: one configuration, for the active environment. */
  | { kind: 'single'; layer: ConfigLayer; errors: string[]; notes: string[] }
  | { kind: 'invalid'; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reads one settings object, leaving out values that stand for an omitted secret. */
function readSettings(raw: Record<string, unknown>): {
  layer: ConfigLayer;
  errors: string[];
  notes: string[];
} {
  const omitted = Object.entries(raw).filter(([, value]) => value === OMITTED);
  const kept = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== OMITTED));
  const { layer, issues } = parseRuntimeObject(kept, 'the file');
  return {
    layer,
    errors: issues.filter((i) => i.severity === 'error').map((i) => i.message),
    notes: [
      ...issues.filter((i) => i.severity !== 'error').map((i) => i.message),
      ...omitted.map(([key]) =>
        key === 'clientSecret'
          ? 'The client secret was left out of the export, so none is set.'
          : `"${key}" was left out of the export.`
      )
    ]
  };
}

function readKey(raw: unknown): { key?: PrivateKeyInput; error?: string } {
  if (raw === undefined) return {};
  if (typeof raw === 'string') {
    if (raw.length > MAX_KEY_INPUT_LENGTH) {
      return {
        error: `backendServicesKey is ${raw.length} characters long; the limit is ${MAX_KEY_INPUT_LENGTH}.`
      };
    }
    return { key: { kind: 'pem', pem: raw } };
  }
  if (isRecord(raw)) {
    if (JSON.stringify(raw).length > MAX_KEY_INPUT_LENGTH) {
      return { error: `backendServicesKey is longer than ${MAX_KEY_INPUT_LENGTH} characters.` };
    }
    return { key: { kind: 'jwk', jwk: raw as JsonWebKey } };
  }
  return { error: 'backendServicesKey must be a private JWK object or a PEM string.' };
}

const KNOWN_ENTRY_KEYS = new Set([
  'id',
  'name',
  'origin',
  'settings',
  'backendServicesKey',
  'publicJwks'
]);

function readEnvironment(raw: unknown, position: number): ParsedEnvironment {
  const fallbackName = `Environment ${position}`;
  if (!isRecord(raw)) {
    return {
      position,
      name: fallbackName,
      layer: {},
      errors: ['This entry is not an object.'],
      notes: []
    };
  }
  const errors: string[] = [];
  const notes: string[] = [];

  const name = sanitizeName(raw.name);
  if (!name) notes.push(`It has no usable name, so it is called "${fallbackName}".`);

  let id: string | undefined;
  if (raw.id !== undefined) {
    if (isEnvironmentId(raw.id) && !raw.id.startsWith('deploy:')) id = raw.id;
    else notes.push('Its id is not a short lowercase name, so it was ignored.');
  }

  let layer: ConfigLayer = {};
  if (raw.settings === undefined) {
    notes.push('It has no settings, so it starts from the built-in defaults.');
  } else if (!isRecord(raw.settings)) {
    errors.push('Its settings are not an object.');
  } else {
    const read = readSettings(raw.settings);
    layer = read.layer;
    errors.push(...read.errors);
    notes.push(...read.notes);
  }

  const { key, error } = readKey(raw.backendServicesKey);
  if (error) errors.push(error);

  for (const unknown of Object.keys(raw)
    .filter((k) => !KNOWN_ENTRY_KEYS.has(k))
    .slice(0, 5)) {
    notes.push(`"${unknown}" is not something an environment has; ignored.`);
  }

  return { position, id, name: name ?? fallbackName, layer, errors, notes, key };
}

/**
 * Reads what was pasted or dropped into the import box: JSON as
 * `parseEnvironmentsFile` reads it, and anything else as `.env` lines, which
 * describe one server and so are one configuration for the active
 * environment. Variables Swiss cannot apply, such as FRAME_ANCESTORS, become
 * notes.
 */
export function parseImportText(text: string): ParsedFile {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parseEnvironmentsFile(text);
  if (text.length > MAX_ENVIRONMENTS_FILE_LENGTH) {
    return {
      kind: 'invalid',
      error: `The text is ${text.length} characters long; the limit is ${MAX_ENVIRONMENTS_FILE_LENGTH}.`
    };
  }
  const { settings, ignored, lines } = settingsFromDotEnv(text);
  if (lines === 0) {
    return {
      kind: 'invalid',
      error: 'Neither JSON nor .env: expected a JSON object or KEY=value lines.'
    };
  }
  const read = readSettings(settings);
  return {
    kind: 'single',
    layer: read.layer,
    errors: read.errors,
    notes: [...ignored, ...read.notes]
  };
}

/** Reads an environments file, a 3.1 export, or a bare settings object. */
export function parseEnvironmentsFile(text: string): ParsedFile {
  if (text.length > MAX_ENVIRONMENTS_FILE_LENGTH) {
    return {
      kind: 'invalid',
      error: `The file is ${text.length} characters long; the limit is ${MAX_ENVIRONMENTS_FILE_LENGTH}.`
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    return {
      kind: 'invalid',
      error: `Not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
    };
  }
  if (!isRecord(raw)) {
    return { kind: 'invalid', error: 'Expected a JSON object.' };
  }

  if (raw.swissEnvironmentsVersion === undefined && raw.environments === undefined) {
    // One configuration: what Swiss 3.1 exported, or a settings object
    // written by hand. It applies to the environment in use.
    const { swissConfigVersion, ...settings } = raw;
    void swissConfigVersion;
    const read = readSettings(settings);
    if (Object.keys(read.layer).length === 0 && read.errors.length === 0) {
      return { kind: 'invalid', error: 'No Swiss settings or environments were found in it.' };
    }
    return { kind: 'single', ...read };
  }

  if (raw.swissEnvironmentsVersion !== ENVIRONMENTS_FORMAT_VERSION) {
    return {
      kind: 'invalid',
      error:
        typeof raw.swissEnvironmentsVersion === 'number' &&
        raw.swissEnvironmentsVersion > ENVIRONMENTS_FORMAT_VERSION
          ? `It was written by a newer Swiss (format ${raw.swissEnvironmentsVersion}); this one reads format ${ENVIRONMENTS_FORMAT_VERSION}.`
          : `"swissEnvironmentsVersion" must be ${ENVIRONMENTS_FORMAT_VERSION}.`
    };
  }
  if (!Array.isArray(raw.environments)) {
    return { kind: 'invalid', error: '"environments" must be a list.' };
  }

  const notes: string[] = [];
  const entries = raw.environments.slice(0, MAX_ENVIRONMENTS);
  if (raw.environments.length > MAX_ENVIRONMENTS) {
    notes.push(
      `Only the first ${MAX_ENVIRONMENTS} of ${raw.environments.length} environments were read.`
    );
  }
  const environments = entries.map((entry, i) => readEnvironment(entry, i + 1));

  // A repeated id would make two environments one. The later entries are
  // refused, and say why.
  const seen = new Set<string>();
  for (const env of environments) {
    if (!env.id) continue;
    if (seen.has(env.id)) env.errors.push(`Its id "${env.id}" is used by an earlier entry.`);
    seen.add(env.id);
  }

  let defaultEnvironment: string | undefined;
  if (typeof raw.defaultEnvironment === 'string') {
    if (environments.some((e) => e.id === raw.defaultEnvironment)) {
      defaultEnvironment = raw.defaultEnvironment;
    } else {
      notes.push(`"defaultEnvironment" names no environment in the file; ignored.`);
    }
  }

  return { kind: 'environments', environments, defaultEnvironment, notes };
}

export interface ExportEntry {
  id: string;
  name: string;
  origin: EnvironmentOrigin;
  config: AppConfig;
  publicJwks?: { keys: JsonWebKey[] };
}

/**
 * Writes every environment given, as an array, with effective values. The
 * client secret is written only when asked for; otherwise one that is set
 * shows as `<omitted>`. Never a private key.
 */
export function serializeEnvironments(
  entries: ExportEntry[],
  options: { includeSecret: boolean; exportedAt?: Date }
): string {
  const environments = entries.map((entry) => {
    const settings = Object.fromEntries(
      FIELDS.map((spec) => {
        const value = entry.config[spec.key];
        if (spec.kind === 'secret' && !options.includeSecret) {
          return [spec.key, value ? OMITTED : ''];
        }
        return [spec.key, value];
      })
    );
    return {
      id: entry.id,
      name: entry.name,
      origin: entry.origin,
      settings,
      ...(entry.publicJwks ? { publicJwks: entry.publicJwks } : {})
    };
  });
  return JSON.stringify(
    {
      swissEnvironmentsVersion: ENVIRONMENTS_FORMAT_VERSION,
      exportedAt: (options.exportedAt ?? new Date()).toISOString(),
      environments
    },
    null,
    2
  );
}
