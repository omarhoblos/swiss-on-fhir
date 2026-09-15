import { describe, expect, it } from 'vitest';
import {
  isAuthorizationIssue,
  isOperationOutcome,
  parseIssues,
  summariseIssues
} from './operation-outcome';

describe('parseIssues', () => {
  it('extracts EVERY issue, not just the first', () => {
    // The Angular UtilService returned only issue[0], discarding the rest --
    // which are often the ones that say what actually went wrong.
    const issues = parseIssues({
      resourceType: 'OperationOutcome',
      issue: [
        { severity: 'error', code: 'invalid', diagnostics: 'first' },
        { severity: 'warning', code: 'incomplete', diagnostics: 'second' },
        { severity: 'information', code: 'informational', diagnostics: 'third' }
      ]
    });
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.diagnostics)).toEqual(['first', 'second', 'third']);
  });

  it('reads details.text', () => {
    const [issue] = parseIssues({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'security', details: { text: 'Access denied' } }]
    });
    expect(issue?.details).toBe('Access denied');
  });

  it('falls back to details.coding when there is no text', () => {
    const [issue] = parseIssues({
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: 'error',
          code: 'forbidden',
          details: { coding: [{ code: 'MSG_NO_ACCESS', display: 'No access' }] }
        }
      ]
    });
    expect(issue?.details).toBe('No access');
  });

  it('keeps expression and location', () => {
    const [issue] = parseIssues({
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: 'error',
          code: 'invalid',
          expression: ['Patient.name'],
          location: ['/f:Patient']
        }
      ]
    });
    expect(issue?.expression).toEqual(['Patient.name']);
    expect(issue?.location).toEqual(['/f:Patient']);
  });

  it('defaults a missing severity or code rather than dropping the issue', () => {
    const [issue] = parseIssues({ resourceType: 'OperationOutcome', issue: [{}] });
    expect(issue).toMatchObject({ severity: 'error', code: 'unknown' });
  });

  it('returns an empty list for an empty or absent issue array', () => {
    expect(parseIssues({ resourceType: 'OperationOutcome', issue: [] })).toEqual([]);
    expect(parseIssues({ resourceType: 'OperationOutcome' })).toEqual([]);
  });

  it('returns an empty list for a non-OperationOutcome', () => {
    expect(parseIssues({ resourceType: 'Patient', id: 'x' })).toEqual([]);
    expect(parseIssues(null)).toEqual([]);
    expect(parseIssues('not json')).toEqual([]);
  });
});

describe('isOperationOutcome', () => {
  it('identifies the resource type', () => {
    expect(isOperationOutcome({ resourceType: 'OperationOutcome' })).toBe(true);
    expect(isOperationOutcome({ resourceType: 'Bundle' })).toBe(false);
    expect(isOperationOutcome(null)).toBe(false);
  });
});

describe('isAuthorizationIssue', () => {
  it('detects permission-shaped codes, which are not server faults', () => {
    expect(isAuthorizationIssue([{ severity: 'error', code: 'security' }])).toBe(true);
    expect(isAuthorizationIssue([{ severity: 'error', code: 'forbidden' }])).toBe(true);
    expect(isAuthorizationIssue([{ severity: 'error', code: 'not-found' }])).toBe(false);
  });
});

describe('summariseIssues', () => {
  it('prefers diagnostics and counts the remainder', () => {
    expect(
      summariseIssues([
        { severity: 'error', code: 'invalid', diagnostics: 'Bad request' },
        { severity: 'error', code: 'invalid', diagnostics: 'Also bad' }
      ])
    ).toBe('Bad request (and 1 more)');
  });

  it('handles an empty list', () => {
    expect(summariseIssues([])).toBe('No issues reported.');
  });
});
