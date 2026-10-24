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

/**
 * How to tell each suite is ready. The OpenID suite is reached through nginx
 * with a self-signed certificate, so it is asked from inside its own
 * container over plain HTTP, with the headers nginx would add: no
 * certificate check is ever turned off. Inferno answers plain HTTP already.
 */
const SUITES = {
  openid: {
    compose: 'conformance/openid/compose.yaml',
    label: 'the OpenID suite',
    ready: {
      exec: [
        'server',
        'wget',
        '-q',
        '-O',
        '/dev/null',
        '--header',
        'X-Forwarded-Proto: https',
        '--header',
        'Host: localhost.emobix.co.uk:8443',
        'http://localhost:8080/api/runner/available'
      ]
    }
  },
  inferno: {
    compose: 'conformance/inferno/compose.yaml',
    label: 'Inferno',
    ready: { url: 'http://localhost:4570/api/test_suites' }
  }
};

const [action, which = 'all'] = process.argv.slice(2);
const names = which === 'all' ? Object.keys(SUITES) : [which];
if (!['up', 'down'].includes(action) || names.some((n) => !(n in SUITES))) {
  console.error('usage: node scripts/conformance.mjs up|down openid|inferno|all');
  process.exit(2);
}

async function isReady(compose, ready) {
  if (ready.url) {
    try {
      return (await fetch(ready.url)).ok;
    } catch {
      return false;
    }
  }
  const probe = spawnSync('docker', ['compose', '-f', compose, 'exec', '-T', ...ready.exec], {
    cwd: root,
    stdio: 'ignore'
  });
  return probe.status === 0;
}

async function waitFor(compose, ready) {
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until) {
    if (await isReady(compose, ready)) return true;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

for (const name of names) {
  const { compose, ready, label } = SUITES[name];
  const args =
    action === 'up'
      ? ['compose', '-f', compose, 'up', '-d', '--build']
      : ['compose', '-f', compose, 'down'];
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (action === 'up') {
    process.stdout.write(`Waiting for ${label} to answer ... `);
    if (!(await waitFor(compose, ready))) {
      console.error('it did not answer within five minutes.');
      process.exit(1);
    }
    console.log('ready.');
  }
}
