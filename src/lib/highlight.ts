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
 * Marking search matches in rendered text, through the CSS Custom Highlight
 * API: the matches are painted without touching the DOM, so Svelte's markup
 * and the text a reader copies stay as they are. Where the browser lacks the
 * API, searching still works and only the marks are missing. The colours are
 * the ::highlight() rules in app.css.
 */

/** Every match. */
export const SEARCH_HIGHLIGHT = 'search';
/** The match a reader has stepped to, drawn over SEARCH_HIGHLIGHT. */
export const CURRENT_HIGHLIGHT = 'search-current';

/**
 * Ranges covering every visible occurrence of each term under `root`,
 * ignoring case. Terms are expected in lower case. Text inside something not
 * displayed is skipped, so stepping through the matches never lands on one
 * the reader cannot see.
 */
export function findText(root: Node, terms: readonly string[]): Range[] {
  const ranges: Range[] = [];
  const wanted = terms.filter(Boolean);
  if (wanted.length === 0) return ranges;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.toLowerCase() ?? '';
    if (!text.trim() || node.parentElement?.getClientRects().length === 0) continue;
    for (const term of wanted) {
      for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) {
        const range = new Range();
        range.setStart(node, at);
        range.setEnd(node, at + term.length);
        ranges.push(range);
      }
    }
  }
  return ranges;
}

/** Paints `ranges` as the highlight `name`; the returned function removes it. */
export function paintHighlight(name: string, ranges: Range[]): () => void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return () => {};
  CSS.highlights.set(name, new Highlight(...ranges));
  return () => CSS.highlights.delete(name);
}
