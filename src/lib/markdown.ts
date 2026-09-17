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
