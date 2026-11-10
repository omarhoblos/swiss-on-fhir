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

import { ENV_BACKED_FIELDS } from './fields';
import type { AppConfig } from './types';

/**
 * Reads `.env` text pasted or dropped into the Config screen's import box.
 *
 * Same rules as `scripts/render-config.mjs`, which reads `.env` for the dev
 * server: not a shell, so `KEY=value` runs to the end of the line, blank
 * lines and `#` comments are skipped, symmetric surrounding quotes are
 * stripped, and a repeated key takes its last value.
 */
export function parseDotEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && /^['"]$/.test(value[0]!)) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

const FIELD_BY_ENV_KEY = new Map(ENV_BACKED_FIELDS.map((spec) => [spec.envKey, spec]));

/** Read by the container only, so a `.env` can carry it but Swiss cannot apply it. */
const DEPLOYMENT_ONLY = new Set(['FRAME_ANCESTORS']);

/**
 * Turns `.env` text into settings keyed as the JSON export keys them, plus a
 * note for each variable left out. An empty value for a setting whose empty
 * means "not provided" (a URL, the scopes) is left out, as the runtime file
 * treats it, so it does not override anything; an empty `CLIENT_SECRET`
 * means "no secret" and is kept.
 */
export function settingsFromDotEnv(text: string): {
  settings: Partial<Record<keyof AppConfig, string>>;
  ignored: string[];
  lines: number;
} {
  const vars = parseDotEnv(text);
  const settings: [keyof AppConfig, string][] = [];
  const ignored: string[] = [];
  for (const [name, value] of vars) {
    const spec = FIELD_BY_ENV_KEY.get(name);
    if (spec) {
      if (value === '' && spec.emptyMeansUnset) continue;
      settings.push([spec.key, value]);
    } else if (DEPLOYMENT_ONLY.has(name)) {
      ignored.push(`${name} is set when the container starts and cannot be changed here; ignored.`);
    } else {
      ignored.push(`${name} is not a setting Swiss reads; ignored.`);
    }
  }
  return { settings: Object.fromEntries(settings), ignored, lines: vars.size };
}
