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
 * Scans the container build of Swiss with OWASP ZAP. Local only.
 *
 *   npm run security:baseline   passive scan, with the AJAX spider (Swiss is a single-page app)
 *   npm run security:full       adds the active scan, which sends attack payloads
 *
 * The image that ships is what is scanned: only nginx sends the security
 * headers. It runs on a private Docker network, twice: without a deployment
 * environments file, and with one mounted, so the /swiss-environments.json
 * location is covered both ways.
 *
 * Every alert ZAP raises must be listed in conformance/owasp/rules.tsv as
 * IGNORE, WARN or FAIL with a reason. An alert not listed, or one listed as
 * FAIL, fails the run. UPDATE_EXPECTATIONS=1 adds unlisted alerts to the file
 * as WARN with a TODO reason, for review.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'baseline';
if (!['baseline', 'full'].includes(mode)) {
  console.error('usage: node scripts/security-scan.mjs baseline|full');
  process.exit(2);
}

// Pinned: rules.tsv is reviewed against this version's alerts (ZAP 2.17.0).
const ZAP =
  'zaproxy/zap-stable@sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6';
const IMAGE = 'swiss-on-fhir:security-scan';
const NETWORK = 'swiss-security-scan';
const TARGET = 'swiss-under-scan';
const results = join(root, 'conformance', 'results', 'owasp');
const config = join(root, 'conformance', 'owasp');
const rulesFile = join(config, 'rules.tsv');

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', ...options });
  if (result.status !== 0 && !options.allowFailure) {
    console.error(result.stderr || result.stdout);
    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed`);
  }
  return result;
}

function startSwiss(withFile) {
  docker(['rm', '-f', TARGET], { allowFailure: true });
  const mounts = withFile
    ? [
        '-v',
        `${join(config, 'sample-environments.json')}:/etc/swiss-environments/environments.json:ro`
      ]
    : [];
  docker(['run', '-d', '--name', TARGET, '--network', NETWORK, ...mounts, IMAGE]);
  for (let i = 0; i < 30; i += 1) {
    const probe = docker(
      ['exec', TARGET, 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:8080/swiss-env.json'],
      {
        allowFailure: true
      }
    );
    if (probe.status === 0) return;
    spawnSync('sleep', ['1']);
  }
  throw new Error('Swiss did not start.');
}

/** One ZAP scan; returns its alerts. */
function scan(name, url, spider) {
  const script = mode === 'full' && spider ? 'zap-full-scan.py' : 'zap-baseline.py';
  const args = [
    'run',
    '--rm',
    '--network',
    NETWORK,
    '-v',
    `${results}:/zap/wrk`,
    ZAP,
    script,
    '-t',
    url,
    ...(spider ? ['-j'] : []),
    '-J',
    `${name}.json`,
    '-r',
    `${name}.html`,
    // Exit codes are ignored: this script judges the alerts against rules.tsv.
    '-I'
  ];
  console.log(`ZAP ${script} ${url}`);
  docker(args, { allowFailure: true, stdio: ['ignore', 'inherit', 'inherit'] });
  const report = join(results, `${name}.json`);
  if (!existsSync(report)) throw new Error(`ZAP wrote no report for ${name}.`);
  const json = JSON.parse(readFileSync(report, 'utf8'));
  return (json.site ?? []).flatMap((site) =>
    (site.alerts ?? []).map((alert) => ({
      // alertRef, not pluginid: one plugin covers several distinct findings
      // (every CSP problem is plugin 10055), each judged on its own.
      id: String(alert.alertRef ?? alert.pluginid),
      name: alert.name,
      risk: alert.riskdesc,
      urls: [...new Set((alert.instances ?? []).map((i) => i.uri))],
      scan: name
    }))
  );
}

function loadRules() {
  if (!existsSync(rulesFile)) return new Map();
  return new Map(
    readFileSync(rulesFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => {
        const [id, action, ...rest] = line.split('\t');
        return [id, { action, note: rest.join('\t') }];
      })
  );
}

mkdirSync(results, { recursive: true });
chmodSync(results, 0o777);
console.log('Building the image ...');
docker(['build', '-q', '-t', IMAGE, '.'], { stdio: ['ignore', 'ignore', 'inherit'] });
docker(['network', 'create', NETWORK], { allowFailure: true });

const alerts = [];
try {
  startSwiss(false);
  alerts.push(...scan(`${mode}-app`, `http://${TARGET}:8080/`, true));
  alerts.push(...scan(`${mode}-runtime-config`, `http://${TARGET}:8080/swiss-env.json`, false));
  alerts.push(
    ...scan(`${mode}-no-environments-file`, `http://${TARGET}:8080/swiss-environments.json`, false)
  );
  startSwiss(true);
  alerts.push(
    ...scan(`${mode}-environments-file`, `http://${TARGET}:8080/swiss-environments.json`, false)
  );
} finally {
  docker(['rm', '-f', TARGET], { allowFailure: true });
  docker(['network', 'rm', NETWORK], { allowFailure: true });
}

const rules = loadRules();
const byId = new Map();
for (const alert of alerts) {
  const seen = byId.get(alert.id) ?? { ...alert, urls: new Set(), scans: new Set() };
  alert.urls.forEach((u) => seen.urls.add(u));
  seen.scans.add(alert.scan);
  byId.set(alert.id, seen);
}

const problems = [];
const lines = [
  `# OWASP ZAP ${mode} scan`,
  '',
  new Date().toISOString(),
  '',
  '| Alert | Risk | Rule | Where |',
  '| --- | --- | --- | --- |'
];
for (const alert of byId.values()) {
  const rule = rules.get(alert.id);
  if (!rule) problems.push(`${alert.id} ${alert.name} (${alert.risk}) is not in rules.tsv.`);
  else if (rule.action === 'FAIL')
    problems.push(`${alert.id} ${alert.name} (${alert.risk}) is listed as FAIL: ${rule.note}`);
  lines.push(
    `| ${alert.id} ${alert.name} | ${alert.risk} | ${rule ? `${rule.action}: ${rule.note}` : 'not listed'} | ${[...alert.urls].slice(0, 3).join(', ')} |`
  );
}
if (problems.length) lines.push('', '## Problems', '', ...problems.map((p) => `- ${p}`));
const summary = join(results, `${mode}-summary.md`);
writeFileSync(summary, `${lines.join('\n')}\n`);

if (process.env.UPDATE_EXPECTATIONS) {
  const added = [...byId.values()].filter((a) => !rules.has(a.id));
  if (added.length) {
    const text = added
      .map(
        (a) => `${a.id}\tWARN\t${a.name} (${a.risk}). TODO: say why this is acceptable or fix it.`
      )
      .join('\n');
    writeFileSync(
      rulesFile,
      `${existsSync(rulesFile) ? readFileSync(rulesFile, 'utf8').trimEnd() + '\n' : ''}${text}\n`
    );
    console.log(`Added ${added.length} alert(s) to rules.tsv for review.`);
  }
}

console.log(`\n${byId.size} distinct alert(s). Summary: ${summary}`);
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
