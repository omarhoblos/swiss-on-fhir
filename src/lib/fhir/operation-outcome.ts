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
 * OperationOutcome parsing.
 *
 * The Angular UtilService returned only `issue[0]`, so any additional issues
 * -- often the ones that actually say what went wrong -- were discarded.
 */

export interface OperationOutcomeIssue {
  severity: string;
  code: string;
  details?: string;
  diagnostics?: string;
  expression?: string[];
  location?: string[];
}

export function isOperationOutcome(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === 'object' &&
    (body as { resourceType?: unknown }).resourceType === 'OperationOutcome'
  );
}

/** Extracts every issue, not just the first. */
export function parseIssues(body: unknown): OperationOutcomeIssue[] {
  if (!isOperationOutcome(body)) return [];
  const issues = (body as { issue?: unknown }).issue;
  if (!Array.isArray(issues)) return [];

  return issues.map((raw) => {
    const issue = (raw ?? {}) as Record<string, unknown>;
    const details = issue.details as { text?: unknown; coding?: unknown } | undefined;

    let detailText: string | undefined;
    if (typeof details?.text === 'string') {
      detailText = details.text;
    } else if (Array.isArray(details?.coding)) {
      const coding = details.coding
        .map((c) => {
          const entry = c as Record<string, unknown>;
          return typeof entry.display === 'string' ? entry.display : String(entry.code ?? '');
        })
        .filter(Boolean);
      detailText = coding.length > 0 ? coding.join(', ') : undefined;
    }

    return {
      severity: typeof issue.severity === 'string' ? issue.severity : 'error',
      code: typeof issue.code === 'string' ? issue.code : 'unknown',
      details: detailText,
      diagnostics: typeof issue.diagnostics === 'string' ? issue.diagnostics : undefined,
      expression: Array.isArray(issue.expression)
        ? issue.expression.filter((e): e is string => typeof e === 'string')
        : undefined,
      location: Array.isArray(issue.location)
        ? issue.location.filter((l): l is string => typeof l === 'string')
        : undefined
    };
  });
}

/** True when the outcome looks like a permission problem, not a server fault. */
export function isAuthorizationIssue(issues: OperationOutcomeIssue[]): boolean {
  return issues.some((i) => ['security', 'forbidden', 'suppressed'].includes(i.code));
}

/** A one-line summary for a header or toast. */
export function summariseIssues(issues: OperationOutcomeIssue[]): string {
  if (issues.length === 0) return 'No issues reported.';
  const first = issues[0];
  if (!first) return 'No issues reported.';
  const text = first.diagnostics ?? first.details ?? first.code;
  return issues.length === 1 ? text : `${text} (and ${issues.length - 1} more)`;
}

export const CORS_HINT =
  'A failure with no detail is usually a CORS or preflight problem rather than a FHIR error. ' +
  'Every request carrying an Authorization header is preflighted, so the server must answer OPTIONS ' +
  'without authentication and list `authorization` in Access-Control-Allow-Headers. Run Diagnostics for a targeted check.';
