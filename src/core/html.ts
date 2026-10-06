/**
 * A minimal scanner for PrairieLearn element tags in question.html. It finds
 * opening tags and their attributes with offsets; it is not a full HTML
 * parser, but it skips comments and handles quoted values containing ">".
 */

interface HtmlAttribute {
  value: string;
  /** Offsets of the value, excluding quotes. */
  startOffset: number;
  endOffset: number;
}

export interface HtmlElement {
  startOffset: number;
  endOffset: number;
  /** Lowercased attribute names. */
  attributes: Map<string, HtmlAttribute>;
}

const attributePattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Replaces HTML comments with spaces, so offsets are unchanged. */
function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Opening tags of `tagName` (case-insensitive), in document order. */
export function findElements(text: string, tagName: string): HtmlElement[] {
  const source = blankComments(text);
  const lower = source.toLowerCase();
  const open = `<${tagName.toLowerCase()}`;
  const elements: HtmlElement[] = [];
  // One forward pass, never rescanning: linear even for unclosed tags
  for (let start = lower.indexOf(open); start !== -1; start = lower.indexOf(open, start + 1)) {
    const attrsOffset = start + open.length;
    if (!/[\s/>]/.test(source[attrsOffset] ?? "")) {
      continue; // e.g. <pl-figure-like
    }
    const end = tagEnd(source, attrsOffset);
    if (end === -1) {
      break; // unterminated: nothing after it can be a complete tag either
    }
    elements.push({
      startOffset: start,
      endOffset: end + 1,
      attributes: parseAttributes(source.slice(attrsOffset, end), attrsOffset),
    });
    start = end;
  }
  return elements;
}

/** Index of the ">" closing a tag whose attributes start at `from`, skipping quoted values. */
function tagEnd(source: string, from: number): number {
  let quote: string | undefined;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) {
        quote = undefined;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

function parseAttributes(attrs: string, offset: number): Map<string, HtmlAttribute> {
  const attributes = new Map<string, HtmlAttribute>();
  for (const attr of attrs.matchAll(attributePattern)) {
    const name = attr[1].toLowerCase();
    if (attributes.has(name)) {
      continue; // HTML keeps the first occurrence
    }
    const value = attr[2] ?? attr[3] ?? attr[4] ?? "";
    const quoted = attr[2] !== undefined || attr[3] !== undefined;
    const valueEnd = offset + attr.index + attr[0].length - (quoted ? 1 : 0);
    attributes.set(name, {
      value,
      startOffset: valueEnd - value.length,
      endOffset: valueEnd,
    });
  }
  return attributes;
}
