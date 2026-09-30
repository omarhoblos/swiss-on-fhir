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
 * Prepares the README for the Docker Hub overview.
 *
 *   node scripts/dockerhub-readme.mjs --repo owner/name --ref v3.1.2 --out dockerhub.md
 *
 * Docker Hub renders Markdown, but not the way GitHub does, so the README is
 * rewritten rather than copied:
 *
 *   - Mermaid blocks are replaced by a link to the diagram on GitHub. Docker
 *     Hub does not render Mermaid, so they would show as source text.
 *   - Relative links become absolute links into the repository at `ref`.
 *     On Docker Hub they would otherwise point nowhere.
 *
 * Links are pinned to the release tag rather than main, so the overview
 * describes the image it sits beside. Code blocks and inline code are left
 * exactly as written.
 *
 * The result is checked before it is written: no Mermaid left, no relative
 * link left, and within Docker Hub's size limit. Docker Hub truncates an
 * over-long description, and a cut-off overview is worse than a stale one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Docker Hub's limit on the full description, in bytes. */
export const DOCKER_HUB_LIMIT_BYTES = 25_000;

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)/;

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
export function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function isRelative(target) {
  return !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target);
}

const LINK = /(!?\[[^\]]*\]\()\s*([^)\s]+)((?:\s+"[^"]*")?\s*\))/g;

/** Where each inline code span starts and ends, so a link inside one is left alone. */
function codeSpans(line) {
  return [...line.matchAll(/`+[^`]*`+/g)].map((m) => [m.index, m.index + m[0].length]);
}

/**
 * Every inline link or image on a line that is not itself inside a code span.
 * Its text may contain code, as in [`compose.yaml`](compose.yaml): only where
 * the link starts decides whether it is prose.
 */
function linksIn(line) {
  const spans = codeSpans(line);
  return [...line.matchAll(LINK)].filter(
    (m) => !spans.some(([a, b]) => m.index >= a && m.index < b)
  );
}

/** Rewrites the target of every relative inline link and image on a line. */
function completeLinks(line, base) {
  let out = '';
  let last = 0;
  for (const m of linksIn(line)) {
    const [whole, open, target, close] = m;
    if (!isRelative(target)) continue;
    out += line.slice(last, m.index) + `${open}${base}${target.replace(/^\.\//, '')}${close}`;
    last = m.index + whole.length;
  }
  return out + line.slice(last);
}

function diagramNote(kind, url) {
  const what = kind === 'sequenceDiagram' ? 'sequence diagram' : 'diagram';
  return `> This ${what} is drawn with Mermaid, which Docker Hub does not display. [View it on GitHub](${url}).`;
}

/**
 * @param {string} markdown the README as written for GitHub
 * @param {{ repo: string, ref: string }} options
 * @returns {string} the README as it should appear on Docker Hub
 */
export function toDockerHubMarkdown(markdown, { repo, ref }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Not an owner/name repository: ${repo}`);
  if (!ref) throw new Error('A ref is required, so links point at what was released');

  const base = `https://github.com/${repo}/blob/${ref}/`;
  const out = [];
  let fence = null; // the open fence, while inside a code block
  let mermaid = null; // the diagram kind, while inside a Mermaid block
  let heading = '';

  for (const line of markdown.split('\n')) {
    const opener = line.match(FENCE);

    if (mermaid !== null) {
      if (opener && opener[2][0] === fence[0] && opener[2].length >= fence.length && !opener[3]) {
        out.push(
          diagramNote(mermaid, `${base}README.md${heading ? `#${githubSlug(heading)}` : ''}`)
        );
        mermaid = null;
        fence = null;
      } else if (!mermaid) {
        mermaid = line.trim().split(/\s/)[0] ?? '';
      }
      continue;
    }

    if (fence) {
      if (opener && opener[2][0] === fence[0] && opener[2].length >= fence.length && !opener[3])
        fence = null;
      out.push(line);
      continue;
    }

    if (opener) {
      fence = opener[2];
      if (opener[3] === 'mermaid') {
        mermaid = '';
        continue;
      }
      out.push(line);
      continue;
    }

    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) heading = h[1];
    out.push(completeLinks(line, base));
  }

  if (fence) throw new Error('The README ends inside a code block');
  return out.join('\n');
}

/** What would be wrong with publishing this; empty when nothing is. */
export function problemsWith(markdown) {
  const problems = [];
  const bytes = Buffer.byteLength(markdown, 'utf8');
  if (bytes > DOCKER_HUB_LIMIT_BYTES) {
    problems.push(
      `It is ${bytes} bytes; Docker Hub keeps only the first ${DOCKER_HUB_LIMIT_BYTES}.`
    );
  }
  if (/^\s*(`{3,}|~{3,})\s*mermaid/m.test(markdown)) problems.push('A Mermaid block is left.');
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) continue;
    for (const [, , target] of linksIn(line)) {
      if (isRelative(target)) problems.push(`A relative link is left: ${target}`);
    }
  }
  return problems;
}

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
  };
  const repo = arg('repo', process.env.GITHUB_REPOSITORY);
  const ref = arg('ref', process.env.GITHUB_REF_NAME);
  const input = arg('in', 'README.md');
  const output = arg('out');
  if (!repo || !ref || !output) {
    console.error(
      'usage: dockerhub-readme.mjs --repo owner/name --ref <tag> --out <file> [--in README.md]'
    );
    process.exit(2);
  }

  const result = toDockerHubMarkdown(readFileSync(input, 'utf8'), { repo, ref });
  const problems = problemsWith(result);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`dockerhub-readme: ${problem}`);
    process.exit(1);
  }
  writeFileSync(output, result, 'utf8');
  console.log(
    `dockerhub-readme: wrote ${output} (${Buffer.byteLength(result, 'utf8')} of ${DOCKER_HUB_LIMIT_BYTES} bytes, links at ${ref})`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
