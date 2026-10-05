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
 * Searching a JSON response, for the FHIR console's search box.
 *
 * A node is a hit when its key (object members only: array indices would
 * match every number typed) or its scalar value contains the query, ignoring
 * case. `paths` holds every hit and every ancestor of one, so the tree can
 * show just the branches that lead to a match. Paths are written by
 * `childPath`, the same function JsonTree names its nodes with.
 */

export interface JsonSearch {
  hits: Set<string>;
  paths: Set<string>;
}

export const ROOT_PATH = '$';

export function childPath(parent: string, key: string, inArray: boolean): string {
  return inArray ? `${parent}[${key}]` : `${parent}.${key}`;
}

export function searchJson(value: unknown, query: string): JsonSearch {
  const needle = query.trim().toLowerCase();
  const hits = new Set<string>();
  const paths = new Set<string>();
  if (!needle) return { hits, paths };

  const contains = (text: string) => text.toLowerCase().includes(needle);

  function walk(node: unknown, path: string, key: string | undefined): boolean {
    let found = false;
    if (node !== null && typeof node === 'object') {
      const inArray = Array.isArray(node);
      const entries: [string, unknown][] = inArray
        ? (node as unknown[]).map((child, i) => [String(i), child])
        : Object.entries(node as Record<string, unknown>);
      for (const [childKey, child] of entries) {
        if (walk(child, childPath(path, childKey, inArray), inArray ? undefined : childKey)) {
          found = true;
        }
      }
    } else if (contains(String(node))) {
      hits.add(path);
    }
    if (key !== undefined && contains(key)) hits.add(path);
    if (found || hits.has(path)) {
      paths.add(path);
      return true;
    }
    return false;
  }

  walk(value, ROOT_PATH, undefined);
  return { hits, paths };
}
