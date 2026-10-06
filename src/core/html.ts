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
  const tagPattern = new RegExp(
    `<${tagName}(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`,
    "gi"
  );
  const elements: HtmlElement[] = [];
  for (const tag of source.matchAll(tagPattern)) {
    const attrsOffset = tag.index + 1 + tagName.length;
    const attributes = new Map<string, HtmlAttribute>();
    for (const attr of tag[1].matchAll(attributePattern)) {
      const name = attr[1].toLowerCase();
      if (attributes.has(name)) {
        continue; // HTML keeps the first occurrence
      }
      const raw = attr[2] ?? attr[3] ?? attr[4];
      const value = raw ?? "";
      const quoted = attr[2] !== undefined || attr[3] !== undefined;
      const valueEnd = attrsOffset + attr.index + attr[0].length - (quoted ? 1 : 0);
      attributes.set(name, {
        value,
        startOffset: valueEnd - value.length,
        endOffset: valueEnd,
      });
    }
    elements.push({
      startOffset: tag.index,
      endOffset: tag.index + tag[0].length,
      attributes,
    });
  }
  return elements;
}
