#!/usr/bin/env node
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

/**
 * Renders config/env.template.json into static/swiss-env.json.
 *
 * This is the local-development counterpart to the container's
 * docker/docker-entrypoint.d/40-swiss-config.sh, which does the same
 * substitution with envsubst at startup. Both write the same artifact so
 * there is one config path, not two.
 *
 *   node scripts/render-config.mjs                  # substitute from .env + process env
 *   node scripts/render-config.mjs --defaults-only  # write placeholders-as-empty
 *
 * --defaults-only is used by `prebuild`. A build must never bake the values
 * from whatever .env happens to sit on the build machine into the image; the
 * container overwrites swiss-env.json at startup anyway.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = resolve(root, 'config/env.template.json');
// Root-level, not under a directory: a served `config/` directory would
// shadow the /config route in nginx. See RUNTIME_CONFIG_PATH.
const targetPath = resolve(root, 'static/swiss-env.json');
const envPath = resolve(root, '.env');

const defaultsOnly = process.argv.includes('--defaults-only');

/**
 * Minimal .env parser. Deliberately NOT a shell: `KEY=value` runs to the end
 * of the line, so spaces and `*` in SCOPES are fine unquoted. Symmetric
 * surrounding quotes are stripped here as a convenience, and the app's URL
 * coercion strips them again at runtime -- `docker run --env-file` does not
 * strip them, so a quoted value reaches the container with its quotes.
 */
function parseDotEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && /^['"]$/.test(value[0])) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fromFile = existsSync(envPath) ? parseDotEnv(readFileSync(envPath, 'utf8')) : {};

/** process.env wins over .env, matching how docker --env-file behaves. */
function lookup(name) {
  if (defaultsOnly) return '';
  return process.env[name] ?? fromFile[name] ?? '';
}

const template = readFileSync(templatePath, 'utf8');

// Substitute ${VAR}. Values are JSON-escaped, which is the one thing envsubst
// cannot do -- see the note in the entrypoint script.
const rendered = template.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name) => {
  const value = lookup(name);
  const escaped = JSON.stringify(String(value));
  return escaped.slice(1, -1);
});

// Fail loudly here rather than shipping a file the browser cannot parse.
try {
  JSON.parse(rendered);
} catch (cause) {
  console.error('render-config: template did not produce valid JSON.');
  console.error(rendered);
  throw cause;
}

mkdirSync(dirname(targetPath), { recursive: true });
const tmp = `${targetPath}.tmp`;
writeFileSync(tmp, rendered + '\n', 'utf8');
renameSync(tmp, targetPath);

const summary = defaultsOnly
  ? 'defaults only (no .env values baked in)'
  : `fhirBaseUrl=${lookup('FHIRENDPOINT_URI') || '<unset>'} authIssuer=${lookup('ISSUER_URI') || '<unset>'}`;
console.log(`render-config: wrote static/swiss-env.json (${summary})`);
