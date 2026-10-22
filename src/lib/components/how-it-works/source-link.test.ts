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

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPOSITORY, repoPath, sourceUrl } from './source-link';

describe('repoPath', () => {
  it('places routes under src/ and other source under src/lib/', () => {
    expect(repoPath('routes/+layout.ts')).toBe('src/routes/+layout.ts');
    expect(repoPath('smart/discovery.ts')).toBe('src/lib/smart/discovery.ts');
    expect(repoPath('config/merge.ts')).toBe('src/lib/config/merge.ts');
  });

  it('keeps paths that start at the repository root', () => {
    expect(repoPath('docker/nginx.conf')).toBe('docker/nginx.conf');
    expect(repoPath('.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml');
    expect(repoPath('config/env.template.json')).toBe('config/env.template.json');
    expect(repoPath('Dockerfile')).toBe('Dockerfile');
  });
});

describe('sourceUrl', () => {
  it('links a file, a folder and a glob on main', () => {
    expect(sourceUrl('http/probe.ts')).toBe(`${REPOSITORY}/blob/main/src/lib/http/probe.ts`);
    expect(sourceUrl('docker/docker-entrypoint.d/')).toBe(
      `${REPOSITORY}/tree/main/docker/docker-entrypoint.d`
    );
    expect(sourceUrl('diagnostics/checks/*.ts')).toBe(
      `${REPOSITORY}/tree/main/src/lib/diagnostics/checks`
    );
  });
});

describe('the documentation page', () => {
  // Every pill must name something that exists, or its link is broken.
  const page = readFileSync('src/routes/how-it-works/+page.svelte', 'utf8');
  const paths = [...page.matchAll(/@render files\(\[([\s\S]*?)\]\)/g)].flatMap(([, list = '']) =>
    [...list.matchAll(/'([^']+)'/g)].flatMap(([, path]) => (path ? [path] : []))
  );

  it('lists related files', () => {
    expect(paths.length).toBeGreaterThan(10);
  });

  it.each(paths)('%s exists in the repository', (path) => {
    const full = repoPath(path);
    const glob = full.indexOf('*');
    expect(existsSync(glob === -1 ? full : full.slice(0, full.lastIndexOf('/', glob)))).toBe(true);
  });
});
