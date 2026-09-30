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

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOCKER_HUB_LIMIT_BYTES,
  githubSlug,
  problemsWith,
  toDockerHubMarkdown
} from './dockerhub-readme.mjs';

const opts = { repo: 'omarhoblos/swiss-on-fhir', ref: 'v3.1.2' };
const BASE = 'https://github.com/omarhoblos/swiss-on-fhir/blob/v3.1.2/';

describe('toDockerHubMarkdown', () => {
  it('replaces a Mermaid block with a link to it under its heading on GitHub', () => {
    const md = [
      '## How it works',
      '',
      '```mermaid',
      'flowchart TB',
      '  a --> b',
      '```',
      'after'
    ].join('\n');
    const out = toDockerHubMarkdown(md, opts);

    expect(out).not.toContain('mermaid');
    expect(out).not.toContain('a --> b');
    expect(out).toContain(`[View it on GitHub](${BASE}README.md#how-it-works)`);
    expect(out.split('\n').at(-1)).toBe('after');
  });

  it('names a sequence diagram as one', () => {
    const md = '# T\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n';
    expect(toDockerHubMarkdown(md, opts)).toContain('This sequence diagram is drawn with Mermaid');
  });

  it('makes relative links absolute at the ref, including ones with code in their text', () => {
    const md = [
      '[`compose.yaml`](compose.yaml) and [notes](./docs/a.md#part) and ![logo](img/logo.png "Logo")'
    ].join('\n');
    expect(toDockerHubMarkdown(md, opts)).toBe(
      `[\`compose.yaml\`](${BASE}compose.yaml) and [notes](${BASE}docs/a.md#part) and ![logo](${BASE}img/logo.png "Logo")`
    );
  });

  it('leaves absolute links, anchors, mail and autolinks alone', () => {
    const md =
      '[a](https://x.test/y) [b](#section) [c](mailto:me@x.test) <http://localhost:4200> [d](//cdn.test/x)';
    expect(toDockerHubMarkdown(md, opts)).toBe(md);
  });

  it('leaves code exactly as written, in blocks and inline', () => {
    const md = [
      'Use `[x](relative.md)` literally.',
      '```bash',
      'echo "[x](relative.md)"',
      '```',
      '~~~',
      '```mermaid',
      '~~~'
    ].join('\n');
    expect(toDockerHubMarkdown(md, opts)).toBe(md);
  });

  it('refuses a missing ref or a malformed repository', () => {
    expect(() => toDockerHubMarkdown('x', { repo: 'omarhoblos/swiss-on-fhir', ref: '' })).toThrow(
      /ref/
    );
    expect(() => toDockerHubMarkdown('x', { repo: 'not a repo', ref: 'v1' })).toThrow(/repository/);
  });

  it('refuses a README that ends inside a code block', () => {
    expect(() => toDockerHubMarkdown('```js\nconst a = 1;', opts)).toThrow(/code block/);
  });
});

describe('problemsWith', () => {
  it('passes a clean document', () => {
    expect(problemsWith(`[a](${BASE}a.md) and \`[b](b.md)\``)).toEqual([]);
  });

  it('names what is wrong', () => {
    expect(problemsWith('```mermaid\ngraph TD\n```')).toContain('A Mermaid block is left.');
    expect(problemsWith('[`x`](x.md)')).toEqual(['A relative link is left: x.md']);
    expect(problemsWith('a'.repeat(DOCKER_HUB_LIMIT_BYTES + 1))[0]).toMatch(
      /Docker Hub keeps only/
    );
  });

  it('counts bytes, not characters', () => {
    // Three bytes each in UTF-8.
    expect(problemsWith('…'.repeat(Math.ceil(DOCKER_HUB_LIMIT_BYTES / 3) + 1))).toHaveLength(1);
  });
});

describe('githubSlug', () => {
  it('matches the anchors GitHub gives headings', () => {
    expect(githubSlug('How it works')).toBe('how-it-works');
    expect(githubSlug('Limits, and when the container refuses to start')).toBe(
      'limits-and-when-the-container-refuses-to-start'
    );
    expect(githubSlug('Docker (pre-built image)')).toBe('docker-pre-built-image');
  });
});

describe('the README as it is', () => {
  it('can be published to Docker Hub', () => {
    const out = toDockerHubMarkdown(readFileSync('README.md', 'utf8'), opts);
    expect(problemsWith(out)).toEqual([]);
  });
});
