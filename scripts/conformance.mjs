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
 * Starts or stops the external conformance suites in Docker, and waits for
 * one to answer before returning.
 *
 *   npm run conformance:up -- openid|inferno|all
 *   npm run conformance:down -- openid|inferno|all
 *
 * Local only; nothing in CI runs these.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SUITES = {
  openid: {
    compose: 'conformance/openid/compose.yaml',
    ready: 'https://localhost.emobix.co.uk:8443/api/runner/available'
  },
  inferno: {
    compose: 'conformance/inferno/compose.yaml',
    ready: 'http://localhost:4570/api/test_suites'
  }
};

const [action, which = 'all'] = process.argv.slice(2);
const names = which === 'all' ? Object.keys(SUITES) : [which];
if (!['up', 'down'].includes(action) || names.some((n) => !(n in SUITES))) {
  console.error('usage: node scripts/conformance.mjs up|down openid|inferno|all');
  process.exit(2);
}

async function waitFor(url) {
  // The OpenID suite's certificate is self-signed; this is a readiness probe
  // against a local container only.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

for (const name of names) {
  const { compose, ready } = SUITES[name];
  const args =
    action === 'up'
      ? ['compose', '-f', compose, 'up', '-d', '--build']
      : ['compose', '-f', compose, 'down'];
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (action === 'up') {
    process.stdout.write(`Waiting for ${name} at ${ready} ... `);
    if (!(await waitFor(ready))) {
      console.error('it did not answer within five minutes.');
      process.exit(1);
    }
    console.log('ready.');
  }
}
