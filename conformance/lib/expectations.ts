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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What each conformance test is expected to end in, and why.
 *
 * Swiss reports problems instead of refusing them, so where a suite expects
 * a client to reject a token, the suite's verdict is only half the story:
 * `swiss` names the finding Swiss must have shown instead. A run fails when
 * a test ends differently from its expectation, or an expected finding is
 * missing. UPDATE_EXPECTATIONS=1 rewrites the file from the run, keeping the
 * reasons already written, for review in the diff.
 */

export interface Expectation {
  /** The suite's verdict, as it reports it. */
  suite: string;
  /** A regular expression one of Swiss's findings must match, when Swiss must have reported something. */
  swiss?: string;
  reason: string;
}

export interface Observation {
  suite: string;
  findings: string[];
  /** The suite's own messages, for the summary. */
  details: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const file = (suite: string) => join(here, '..', 'expectations', `${suite}.json`);

export function loadExpectations(suite: string): Record<string, Expectation> {
  try {
    return JSON.parse(readFileSync(file(suite), 'utf8')).tests ?? {};
  } catch {
    return {};
  }
}

/** Problems with one observation, against its expectation. */
export function compare(
  name: string,
  expected: Expectation | undefined,
  observed: Observation
): string[] {
  if (!expected) return [`${name}: not in the expectations file (ended ${observed.suite}).`];
  const problems: string[] = [];
  if (expected.suite !== observed.suite) {
    problems.push(`${name}: expected ${expected.suite}, the suite said ${observed.suite}.`);
  }
  if (
    expected.swiss &&
    !observed.findings.some((f) => new RegExp(expected.swiss as string, 'i').test(f))
  ) {
    problems.push(`${name}: Swiss did not show a finding matching /${expected.swiss}/.`);
  }
  return problems;
}

export function writeExpectations(
  suite: string,
  description: string,
  observed: Record<string, Observation>,
  previous: Record<string, Expectation>
): void {
  const tests = Object.fromEntries(
    Object.entries(observed).map(([name, o]) => [
      name,
      {
        suite: o.suite,
        ...(previous[name]?.swiss ? { swiss: previous[name]?.swiss } : {}),
        reason: previous[name]?.reason ?? 'TODO: say why this is the expected outcome.'
      }
    ])
  );
  writeFileSync(file(suite), `${JSON.stringify({ description, tests }, null, 2)}\n`);
}

/** A Markdown summary in conformance/results, beside the suite's own exports. */
export function writeSummary(
  suite: string,
  observed: Record<string, Observation>,
  expected: Record<string, Expectation>,
  problems: string[]
): string {
  const dir = join(here, '..', 'results');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${suite}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  const lines = [
    `# Conformance run: ${suite}`,
    '',
    `${new Date().toISOString()} · ${problems.length === 0 ? 'every result as expected' : `${problems.length} unexpected`}`,
    '',
    '| Test | Suite | Expected | Swiss reported |',
    '| --- | --- | --- | --- |',
    ...Object.entries(observed).map(
      ([name, o]) =>
        `| ${name} | ${o.suite} | ${expected[name]?.suite ?? '?'} | ${
          o.findings.length
            ? o.findings
                .map((f) => f.replace(/\s+/g, ' ').slice(0, 120))
                .join('; ')
                .replace(/\|/g, '/')
            : 'nothing'
        } |`
    ),
    '',
    ...(problems.length ? ['## Unexpected', '', ...problems.map((p) => `- ${p}`), ''] : []),
    '## Suite details',
    '',
    ...Object.entries(observed).flatMap(([name, o]) =>
      o.details.length
        ? [`### ${name}`, '', ...o.details.map((d) => `- ${d.replace(/\s+/g, ' ')}`), '']
        : []
    )
  ];
  writeFileSync(path, lines.join('\n'));
  return path;
}
