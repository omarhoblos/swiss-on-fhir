import { describe, expect, it, vi } from 'vitest';
import { runChecks, summarise, topoSort, toMarkdown } from './runner';
import { result, type Check, type DiagnosticsContext } from './types';
import { DEFAULTS } from '$lib/config/defaults';

function ctx(): DiagnosticsContext {
  return {
    config: DEFAULTS,
    origin: 'http://localhost:4200',
    endpoints: {},
    docs: {},
    gates: null,
    documentUrls: {},
    session: null
  };
}

function check(id: string, status: 'pass' | 'warn' | 'fail', extra: Partial<Check> = {}): Check {
  return {
    id,
    title: `Check ${id}`,
    group: 'environment',
    async run() {
      return result({ status, summary: `${id} says ${status}` });
    },
    ...extra
  };
}

describe('topoSort', () => {
  it('orders dependencies before their dependents', () => {
    const checks = [
      check('c', 'pass', { dependsOn: ['b'] }),
      check('a', 'pass'),
      check('b', 'pass', { dependsOn: ['a'] })
    ];
    expect(topoSort(checks).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores a dependency that is not in the set', () => {
    const checks = [check('a', 'pass', { dependsOn: ['not-registered'] })];
    expect(topoSort(checks).map((c) => c.id)).toEqual(['a']);
  });

  it('throws on a dependency cycle, which is a programming error', () => {
    const checks = [
      check('a', 'pass', { dependsOn: ['b'] }),
      check('b', 'pass', { dependsOn: ['a'] })
    ];
    expect(() => topoSort(checks)).toThrow(/cycle/i);
  });
});

describe('runChecks', () => {
  it('runs every check and returns a result for each', async () => {
    const results = await runChecks([check('a', 'pass'), check('b', 'warn')], ctx());
    expect(results.map((r) => r.status)).toEqual(['pass', 'warn']);
  });

  it('continues past a failure when nothing depends on it', async () => {
    // A failing check must not abort the run: the later results are often
    // what explain the earlier failure.
    const results = await runChecks([check('a', 'fail'), check('b', 'pass')], ctx());
    expect(results.map((r) => r.status)).toEqual(['fail', 'pass']);
  });

  it('skips a dependent check and names the blocker', async () => {
    const results = await runChecks(
      [check('a', 'fail'), check('b', 'pass', { dependsOn: ['a'] })],
      ctx()
    );
    const skipped = results.find((r) => r.id === 'b');
    expect(skipped?.status).toBe('skip');
    expect(skipped?.summary).toContain('Check a');
  });

  it('does not skip a dependent when the dependency only warned', async () => {
    const results = await runChecks(
      [check('a', 'warn'), check('b', 'pass', { dependsOn: ['a'] })],
      ctx()
    );
    expect(results.find((r) => r.id === 'b')?.status).toBe('pass');
  });

  it('reports a thrown check as a Swiss bug, not a server problem', async () => {
    const exploding: Check = {
      id: 'boom',
      title: 'Exploding check',
      group: 'environment',
      async run() {
        throw new Error('kaboom');
      }
    };
    const results = await runChecks([exploding], ctx());
    expect(results[0]?.status).toBe('fail');
    expect(results[0]?.summary).toContain('bug in Swiss');
    expect(results[0]?.detail).toContain('kaboom');
  });

  it('holds back a mutating check unless explicitly included', async () => {
    const mutating = check('m', 'pass', { mutating: true });
    const held = await runChecks([mutating], ctx());
    expect(held[0]?.status).toBe('manual');

    const run = await runChecks([mutating], ctx(), { includeMutating: true });
    expect(run[0]?.status).toBe('pass');
  });

  it('streams results as they land', async () => {
    const onResult = vi.fn();
    await runChecks([check('a', 'pass'), check('b', 'pass')], ctx(), { onResult });
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it('stops early when aborted', async () => {
    const controller = new AbortController();
    const first: Check = {
      id: 'a',
      title: 'First',
      group: 'environment',
      async run() {
        controller.abort();
        return result({ status: 'pass', summary: 'ok' });
      }
    };
    const results = await runChecks([first, check('b', 'pass')], ctx(), {
      signal: controller.signal
    });
    expect(results.map((r) => r.id)).toEqual(['a']);
  });
});

describe('summarise', () => {
  it('counts each status', async () => {
    const results = await runChecks(
      [check('a', 'pass'), check('b', 'warn'), check('c', 'fail')],
      ctx()
    );
    const s = summarise(results);
    expect(s).toMatchObject({ pass: 1, warn: 1, fail: 1, total: 3 });
  });
});

describe('toMarkdown', () => {
  it('includes the origin, the summary and each check title', async () => {
    const results = await runChecks([check('a', 'fail')], ctx());
    const md = toMarkdown(results, { origin: 'http://localhost:4200' });
    expect(md).toContain('# Swiss on FHIR diagnostics');
    expect(md).toContain('http://localhost:4200');
    expect(md).toContain('Check a');
    expect(md).toContain('1 failed');
  });
});
