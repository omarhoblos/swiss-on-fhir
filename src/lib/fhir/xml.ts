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
 * FHIR XML, read with the browser's own DOMParser.
 *
 * Swiss does not convert between XML and JSON: that needs the FHIR type
 * model (choice types, primitive extensions, the narrative's XHTML), and a
 * converter that gets it subtly wrong would misreport the server. What the
 * console needs from a response is small -- the resource type and id, a
 * Bundle's entries and next link, an OperationOutcome's issues -- so an XML
 * response is read into an outline of just those, in the JSON shape the
 * existing code already understands, and the body itself is shown as XML.
 *
 * Browser only: the unit tests run in node, which has no DOMParser, so this
 * is covered end to end.
 */

export const FHIR_NAMESPACE = 'http://hl7.org/fhir';

export type BodyFormat = 'json' | 'xml';

export const FHIR_MIME: Record<BodyFormat, string> = {
  json: 'application/fhir+json',
  xml: 'application/fhir+xml'
};

/**
 * An XML document as plain data, for the response tree: elements with their
 * attributes and children, text, and comments. Whitespace-only text between
 * elements is left out, as a formatter would.
 */
export type XmlNode =
  XmlElement | { kind: 'text'; text: string } | { kind: 'comment'; text: string };

export interface XmlElement {
  kind: 'element';
  name: string;
  attributes: [name: string, value: string][];
  children: XmlNode[];
}

/**
 * How deep the tree is built. Deeper than any real FHIR resource, and well
 * short of what the recursive tree component can render: a body nested past
 * it is shown as text instead.
 */
export const MAX_TREE_DEPTH = 256;

export interface FhirXml {
  /** JSON-shaped outline of the resource, or null when it is not FHIR XML. */
  outline: Record<string, unknown> | null;
  /** The document as a tree, or null when it did not parse or is nested too deeply. */
  tree: XmlElement | null;
  /** Indented for reading, or null when the XML did not parse. */
  pretty: string | null;
  /** Why the body is not FHIR XML, or null. */
  problem: string | null;
}

/** Whether a response body should be read as XML. */
export function isXmlResponse(contentType: string, text: string): boolean {
  return /xml/i.test(contentType) || /^\s*<\?xml/.test(text);
}

function parse(text: string): Document | string {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (!error) return doc;
  // Chromium puts the message in a <div>; Firefox leads with it, then the
  // location and the offending source on the following lines.
  const message = (error.querySelector('div')?.textContent ?? error.textContent ?? '').trim();
  return message.split('\n')[0]?.trim() || 'not well-formed';
}

/** Why the text is not well-formed XML, or null when it is. */
export function xmlSyntaxError(text: string): string | null {
  const result = parse(text);
  return typeof result === 'string' ? result : null;
}

export function readFhirXml(text: string): FhirXml {
  const doc = parse(text);
  if (typeof doc === 'string') {
    return { outline: null, tree: null, pretty: null, problem: `The XML did not parse: ${doc}` };
  }
  const root = doc.documentElement;
  const pretty = prettyOrNull(doc);
  const tree = toTree(root);
  if (root.namespaceURI !== FHIR_NAMESPACE) {
    return {
      outline: null,
      tree,
      pretty,
      problem: `Not FHIR XML: the root element <${root.tagName}> is not in the ${FHIR_NAMESPACE} namespace.`
    };
  }
  return {
    outline: outline(root),
    tree,
    pretty,
    problem: pretty === null ? 'Nested too deeply to lay out; showing the body as received.' : null
  };
}

/**
 * Laying out walks the tree recursively, so a body nested deep enough --
 * by accident or by a hostile server -- exhausts the stack. That is caught
 * here and the body shown as it came, rather than surfacing as a failed
 * request.
 */
function prettyOrNull(doc: Document): string | null {
  try {
    return prettyXml(doc);
  } catch {
    return null;
  }
}

/** The element as a tree, or null when it is nested deeper than MAX_TREE_DEPTH. */
export function toTree(root: Element): XmlElement | null {
  const build = (el: Element, depth: number): XmlElement => {
    if (depth > MAX_TREE_DEPTH) throw new RangeError('too deep');
    const kids: XmlNode[] = [];
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === ELEMENT) kids.push(build(node as Element, depth + 1));
      else if (node.nodeType === TEXT || node.nodeType === CDATA) {
        const text = node.textContent ?? '';
        if (text.trim()) kids.push({ kind: 'text', text: text.trim() });
      } else if (node.nodeType === COMMENT) {
        kids.push({ kind: 'comment', text: (node.textContent ?? '').trim() });
      }
    }
    return {
      kind: 'element',
      name: el.tagName,
      attributes: Array.from(el.attributes).map((a) => [a.name, a.value]),
      children: kids
    };
  };
  try {
    return build(root, 0);
  } catch {
    return null;
  }
}

function children(el: Element, name: string): Element[] {
  return Array.from(el.children).filter(
    (c) => c.localName === name && c.namespaceURI === FHIR_NAMESPACE
  );
}

/** A FHIR primitive's `value` attribute, from the first child of that name. */
function value(el: Element | undefined, name: string): string | undefined {
  if (!el) return undefined;
  return children(el, name)[0]?.getAttribute('value') ?? undefined;
}

function values(el: Element, name: string): string[] {
  return children(el, name)
    .map((c) => c.getAttribute('value'))
    .filter((v): v is string => v !== null);
}

function outline(root: Element): Record<string, unknown> {
  const out: Record<string, unknown> = { resourceType: root.localName };
  const id = value(root, 'id');
  if (id !== undefined) out.id = id;

  if (root.localName === 'Bundle') {
    // Only counted, so an empty object stands in for each entry.
    out.entry = children(root, 'entry').map(() => ({}));
    out.link = children(root, 'link').map((link) => ({
      relation: value(link, 'relation'),
      url: value(link, 'url')
    }));
  }

  if (root.localName === 'OperationOutcome') {
    out.issue = children(root, 'issue').map((issue) => {
      const details = children(issue, 'details')[0];
      return {
        severity: value(issue, 'severity'),
        code: value(issue, 'code'),
        diagnostics: value(issue, 'diagnostics'),
        details: details && {
          text: value(details, 'text'),
          coding: children(details, 'coding').map((c) => ({
            code: value(c, 'code'),
            display: value(c, 'display')
          }))
        },
        expression: values(issue, 'expression'),
        location: values(issue, 'location')
      };
    });
  }
  return out;
}

const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;
const PROCESSING_INSTRUCTION = 7;
const COMMENT = 8;

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

function openTag(el: Element, selfClosing: boolean): string {
  const attrs = Array.from(el.attributes)
    .map((a) => ` ${a.name}="${escapeAttribute(a.value)}"`)
    .join('');
  return `<${el.tagName}${attrs}${selfClosing ? '/>' : '>'}`;
}

/** A node on one line, whitespace kept: for mixed content such as a narrative. */
function inline(node: Node): string {
  switch (node.nodeType) {
    case ELEMENT: {
      const el = node as Element;
      if (el.childNodes.length === 0) return openTag(el, true);
      const inner = Array.from(el.childNodes).map(inline).join('');
      return `${openTag(el, false)}${inner}</${el.tagName}>`;
    }
    case TEXT:
      return escapeText(node.textContent ?? '');
    case CDATA:
      return `<![CDATA[${node.textContent ?? ''}]]>`;
    case COMMENT:
      return `<!--${node.textContent ?? ''}-->`;
    case PROCESSING_INSTRUCTION: {
      const pi = node as ProcessingInstruction;
      return `<?${pi.target} ${pi.data}?>`;
    }
    default:
      return '';
  }
}

/**
 * Indented XML, two spaces a level. An element holding text alongside
 * elements -- a narrative's XHTML -- is kept on one line as it came, since
 * re-indenting it would change the text it carries.
 */
export function prettyXml(doc: Document): string {
  const lines: string[] = [];
  const walk = (node: Node, depth: number) => {
    const pad = '  '.repeat(depth);
    if (node.nodeType !== ELEMENT) {
      const text = inline(node);
      if (text.trim()) lines.push(pad + text.trim());
      return;
    }
    const el = node as Element;
    const kids = Array.from(el.childNodes).filter(
      (k) => !(k.nodeType === TEXT && !(k.textContent ?? '').trim())
    );
    const mixed = kids.some((k) => k.nodeType === TEXT || k.nodeType === CDATA);
    if (kids.length === 0) {
      lines.push(pad + openTag(el, true));
      return;
    }
    if (mixed) {
      lines.push(pad + inline(el));
      return;
    }
    lines.push(pad + openTag(el, false));
    for (const kid of kids) walk(kid, depth + 1);
    lines.push(`${pad}</${el.tagName}>`);
  };
  for (const node of Array.from(doc.childNodes)) walk(node, 0);
  return lines.join('\n');
}
