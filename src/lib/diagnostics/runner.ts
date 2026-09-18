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

import type { Check, CheckResult, DiagnosticsContext } from './types';

/**
 * Runs checks in order, streaming results as they land.
 *
 * Sequential, not parallel, for two reasons: the order is the narrative
 * ("reachable -> parses -> has the required fields -> supports what you
 * asked for"), and concurrent probes muddy the timing evidence that makes a
 * slow endpoint visible.
 *
 * A failure does not stop the run. Only a declared dependency failing skips
 * a check, and then the reason names the blocker rather than leaving a bare
 * "skipped".
 */

export interface RunOptions {
  /** Include checks that change state on the server. */
  includeMutating?: boolean;
  signal?: AbortSignal;
  /** Called as each result lands, so the UI can render progressively. */
  onResult?: (result: CheckResult) => void;
}

export function topoSort(checks: Check[]): Check[] {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: Check[] = [];

  const visit = (check: Check) => {
    if (visited.has(check.id)) return;
    if (visiting.has(check.id)) {
      // A dependency cycle is a programming error, not a user-facing one.
      throw new Error(`Dependency cycle in diagnostics checks at "${check.id}"`);
    }
    visiting.add(check.id);
    for (const depId of check.dependsOn ?? []) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    visiting.delete(check.id);
    visited.add(check.id);
    ordered.push(check);
  };

  for (const check of checks) visit(check);
  return ordered;
}

export async function runChecks(
  checks: Check[],
  ctx: DiagnosticsContext,
  options: RunOptions = {}
): Promise<CheckResult[]> {
  const ordered = topoSort(checks);
  const byId = new Map<string, CheckResult>();

  for (const check of ordered) {
    if (options.signal?.aborted) break;

    const blocker = (check.dependsOn ?? [])
      .map((id) => byId.get(id))
      .find((r) => r?.status === 'fail');

    if (blocker) {
      const skipped: CheckResult = {
        id: check.id,
        title: check.title,
        group: check.group,
        status: 'skip',
        summary: `Skipped because "${blocker.title}" failed.`,
        remediations: [],
        exchanges: [],
        durationMs: 0
      };
      byId.set(check.id, skipped);
      options.onResult?.(skipped);
      continue;
    }

    if (check.mutating && !options.includeMutating) {
      const manual: CheckResult = {
        id: check.id,
        title: check.title,
        group: check.group,
        status: 'manual',
        summary: 'Not run automatically: this check changes state on your server.',
        remediations: [],
        exchanges: [],
        durationMs: 0
      };
      byId.set(check.id, manual);
      options.onResult?.(manual);
      continue;
    }

    const startedAt = performance.now();
    let checkResult: CheckResult;
    try {
      const partial = await check.run(ctx);
      checkResult = {
        id: check.id,
        title: check.title,
        group: check.group,
        durationMs: Math.round(performance.now() - startedAt),
        ...partial
      };
    } catch (cause) {
      // Be explicit about whose fault this is. A thrown check is a Swiss bug,
      // and telling the user their server is broken would be wrong.
      checkResult = {
        id: check.id,
        title: check.title,
        group: check.group,
        status: 'fail',
        summary:
          'This check itself threw an error, which is a bug in Swiss rather than a problem with your server.',
        detail: cause instanceof Error ? `${cause.message}\n\n${cause.stack ?? ''}` : String(cause),
        remediations: [],
        exchanges: [],
        durationMs: Math.round(performance.now() - startedAt)
      };
    }

    byId.set(check.id, checkResult);
    options.onResult?.(checkResult);
  }

  return [...byId.values()];
}

export interface DiagnosticsSummary {
  pass: number;
  warn: number;
  fail: number;
  skip: number;
  manual: number;
  total: number;
}

export function summarise(results: CheckResult[]): DiagnosticsSummary {
  const summary: DiagnosticsSummary = {
    pass: 0,
    warn: 0,
    fail: 0,
    skip: 0,
    manual: 0,
    total: results.length
  };
  for (const r of results) {
    if (r.status === 'running') continue;
    summary[r.status] += 1;
  }
  return summary;
}

/**
 * A Markdown report, redacted by default.
 *
 * For a tool whose users file GitHub issues, "copy the diagnostics report" is
 * worth as much as the checks themselves -- provided it is safe to paste.
 */
export function toMarkdown(results: CheckResult[], meta: { origin: string | null }): string {
  const icon: Record<string, string> = {
    pass: '✅',
    warn: '⚠️',
    fail: '❌',
    skip: '⏭️',
    manual: '🔍',
    running: '⏳'
  };

  const lines: string[] = [
    '# Swiss on FHIR diagnostics',
    '',
    `Origin: \`${meta.origin ?? 'unknown'}\``,
    `Run at: ${new Date().toISOString()}`,
    ''
  ];

  const s = summarise(results);
  lines.push(
    `**${s.pass} passed, ${s.warn} warnings, ${s.fail} failed, ${s.skip} skipped, ${s.manual} manual**`,
    ''
  );

  let currentGroup = '';
  for (const r of results) {
    if (r.group !== currentGroup) {
      currentGroup = r.group;
      lines.push(`## ${currentGroup}`, '');
    }
    lines.push(`### ${icon[r.status] ?? ''} ${r.title}`, '', r.summary, '');
    if (r.detail) lines.push(r.detail, '');
    for (const rem of r.remediations) {
      lines.push(`**${rem.label}**`, '', rem.body, '');
    }
    for (const x of r.exchanges) {
      lines.push(
        `<details><summary><code>${x.request.method} ${x.request.url}</code> — ${
          x.response ? `${x.response.status} ${x.response.statusText}` : x.outcome
        } (${x.durationMs}ms)</summary>`,
        ''
      );
      if (x.redactions.length > 0) {
        lines.push(`Redacted: ${x.redactions.join(', ')}`, '');
      }
      if (x.response?.body) {
        const body = x.response.body.slice(0, 4000);
        lines.push('```json', body, '```', '');
      }
      if (x.diagnosis) {
        lines.push(
          `Likely cause: **${x.diagnosis.likelyCause}** (${x.diagnosis.confidence})`,
          '',
          ...x.diagnosis.evidence.map((e) => `- ${e}`),
          ''
        );
      }
      lines.push('</details>', '');
    }
  }

  return lines.join('\n');
}
