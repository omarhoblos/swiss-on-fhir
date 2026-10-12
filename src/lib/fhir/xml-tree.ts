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

import { childPath, ROOT_PATH, type JsonSearch } from './search';
import type { XmlNode } from './xml';

/**
 * Searching and copying the XML response tree, the counterparts of what
 * search.ts does for JSON. Nodes are named by their position among their
 * parent's children, with the same `childPath` JsonTree uses, so the tree
 * and the search agree on what a path means.
 *
 * Plain data in, plain data out: no DOM, so it runs under the unit tests.
 */

/**
 * A node is a hit when its element name, an attribute's name or value, or
 * its text contains the query, ignoring case. As for JSON, `paths` holds
 * every hit and every ancestor of one.
 */
export function searchXml(root: XmlNode, query: string): JsonSearch {
  const needle = query.trim().toLowerCase();
  const hits = new Set<string>();
  const paths = new Set<string>();
  if (!needle) return { hits, paths };

  const contains = (text: string) => text.toLowerCase().includes(needle);

  function walk(node: XmlNode, path: string): boolean {
    let found = false;
    if (node.kind === 'element') {
      if (contains(node.name) || node.attributes.some(([n, v]) => contains(n) || contains(v))) {
        hits.add(path);
      }
      node.children.forEach((child, i) => {
        if (walk(child, childPath(path, String(i), true))) found = true;
      });
    } else if (contains(node.text)) {
      hits.add(path);
    }
    if (found || hits.has(path)) {
      paths.add(path);
      return true;
    }
    return false;
  }

  walk(root, ROOT_PATH);
  return { hits, paths };
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function openTag(node: Extract<XmlNode, { kind: 'element' }>, selfClosing: boolean): string {
  const attrs = node.attributes
    .map(([name, value]) => ` ${name}="${escapeText(value).replace(/"/g, '&quot;')}"`)
    .join('');
  return `<${node.name}${attrs}${selfClosing ? '/>' : '>'}`;
}

/** A node as indented XML text, for copying a subtree. */
export function xmlNodeText(node: XmlNode, depth = 0): string {
  const pad = '  '.repeat(depth);
  if (node.kind === 'text') return pad + escapeText(node.text);
  if (node.kind === 'comment') return `${pad}<!--${node.text}-->`;
  if (node.children.length === 0) return pad + openTag(node, true);
  const inner = node.children.map((child) => xmlNodeText(child, depth + 1)).join('\n');
  return `${pad}${openTag(node, false)}\n${inner}\n${pad}</${node.name}>`;
}
