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
 * The small slice of Markdown that check summaries, details and remediations
 * are written in.
 *
 * The same strings go verbatim into the downloaded report, where Markdown is
 * the point, so on screen they are parsed rather than rewritten. Parsed into
 * tokens, never HTML: the text interpolates values from servers under test,
 * and rendering tokens as elements keeps that out of `{@html}`.
 */

export type Inline =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'em'; value: string };

export type Block =
  /** One entry per source line, so hard line breaks survive. */
  { kind: 'paragraph'; lines: Inline[][] } | { kind: 'list'; items: Inline[][] };

/**
 * `code` first so nothing inside a code span is read as emphasis, then
 * **strong**, then _em_ -- the last only at word boundaries, so a snake_case
 * name outside backticks stays text.
 */
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g;

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    if (match.index > last) out.push({ kind: 'text', value: line.slice(last, match.index) });
    const [, code, strong, em] = match;
    if (code !== undefined) out.push({ kind: 'code', value: code });
    else if (strong !== undefined) out.push({ kind: 'strong', value: strong });
    else out.push({ kind: 'em', value: em ?? '' });
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push({ kind: 'text', value: line.slice(last) });
  return out;
}

/**
 * A fenced code block that its content cannot close.
 *
 * The exported reports put response bodies inside fences, and a body is
 * server text: one containing a line of three backticks ended the block
 * early, and whatever followed was rendered as the report's own Markdown
 * wherever it was pasted. CommonMark closes a fence only with a run at least
 * as long as the one that opened it, so the fence is made one longer than the
 * longest run in the content.
 */
export function fenced(content: string, language = ''): string[] {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [`${fence}${language}`, content, fence];
}

/** Escapes text for the raw HTML the reports use (`<details>`, `<summary>`). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\r\n]+/g, ' ');
}

const LIST_ITEM = /^\s*[-*]\s+/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      current = null;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      if (current?.kind !== 'list') blocks.push((current = { kind: 'list', items: [] }));
      current.items.push(parseInline(line.replace(LIST_ITEM, '')));
    } else {
      if (current?.kind !== 'paragraph') blocks.push((current = { kind: 'paragraph', lines: [] }));
      current.lines.push(parseInline(line));
    }
  }
  return blocks;
}
