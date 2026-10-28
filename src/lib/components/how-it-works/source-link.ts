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
 * Where the related-file pills on the documentation page link to. They point
 * at the main branch, so they show the newest code rather than the version
 * being run.
 */
export const REPOSITORY = 'https://github.com/omarhoblos/swiss-on-fhir';
const BRANCH = 'main';

/**
 * Pill paths that start at the repository root. A folder ends in `/` and
 * covers everything under it; anything else must match exactly. The top-level
 * `config/` holds only the env template, while `config/*.ts` is src/lib/config.
 */
const ROOT = [
  '.do/',
  '.github/',
  'docker/',
  'e2e/',
  'scripts/',
  'config/env.template.json',
  'compose.yaml',
  'Dockerfile',
  'vite.config.ts'
];

/** A pill's path as it sits in the repository: `routes/` is under src/, other source under src/lib/. */
export function repoPath(path: string): string {
  if (ROOT.some((root) => (root.endsWith('/') ? path.startsWith(root) : path === root))) {
    return path;
  }
  return path.startsWith('routes/') ? `src/${path}` : `src/lib/${path}`;
}

/** The page for a pill on the main branch. A folder, or a glob such as `checks/*.ts`, opens its folder. */
export function sourceUrl(path: string): string {
  const full = repoPath(path);
  const glob = full.indexOf('*');
  const target = glob === -1 ? full : full.slice(0, full.lastIndexOf('/', glob) + 1);
  const kind = target.endsWith('/') ? 'tree' : 'blob';
  return `${REPOSITORY}/${kind}/${BRANCH}/${target.replace(/\/$/, '')}`;
}
