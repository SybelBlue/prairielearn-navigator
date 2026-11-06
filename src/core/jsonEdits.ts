import * as path from "node:path";
import { createScanner, findNodeAtLocation, FormattingOptions, modify, Node, SyntaxKind } from "jsonc-parser";
import { edit, FileEdit } from "./fileEdits";
import { JsonPath, parseJsonDoc } from "./json";
import { treeOf } from "./jsonTree";

/** Formatting that matches `text`'s indentation and line endings. */
function jsonFormatting(text: string): Required<Pick<FormattingOptions, "insertSpaces" | "tabSize" | "eol">> {
  const indentation = text.match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
  return {
    insertSpaces: !indentation.includes("\t"),
    tabSize: indentation.includes("\t") ? 1 : indentation.length,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
  };
}

/** What follows an array's last entry, up to the end of its line or the array. */
function afterLastEntry(text: string, last: Node) {
  const scanner = createScanner(text, false);
  scanner.setPosition(last.offset + last.length);
  let end = last.offset + last.length;
  let hasComma = false;
  for (;;) {
    switch (scanner.scan()) {
      case SyntaxKind.Trivia:
        break;
      case SyntaxKind.CommaToken:
        hasComma = true;
        end = scanner.getTokenOffset() + scanner.getTokenLength();
        break;
      case SyntaxKind.LineCommentTrivia:
      case SyntaxKind.BlockCommentTrivia:
        end = scanner.getTokenOffset() + scanner.getTokenLength();
        break;
      case SyntaxKind.LineBreakTrivia:
        return { end, hasComma, arrayEnds: false };
      default:
        return { end, hasComma, arrayEnds: true };
    }
  }
}

/** A flat entry on one line, as `{ "a": 1, "b": "c" }`. */
function inlineEntry(value: object): string {
  const members = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{ ${members.join(", ")} }`;
}

/**
 * Inserts after `last` without touching it. `modify` would reformat a one-line
 * entry and strand a comment after it, so the new entry instead copies the
 * style of the one before it, and goes after that entry's trailing comment.
 */
function insertAfter(file: string, text: string, last: Node, value: object): FileEdit[] {
  const lastEnd = last.offset + last.length;
  const { end, hasComma, arrayEnds } = afterLastEntry(text, last);
  const { insertSpaces, tabSize, eol } = jsonFormatting(text);
  const inline = arrayEnds || !text.slice(last.offset, lastEnd).includes("\n");

  const lineStart = text.lastIndexOf("\n", last.offset) + 1;
  const indent = text.slice(lineStart).match(/^[ \t]*/)?.[0] ?? "";
  const unit = insertSpaces ? " ".repeat(tabSize) : "\t";
  const rendered = inline
    ? inlineEntry(value)
    : JSON.stringify(value, undefined, unit).split("\n").join(eol + indent);
  const entry = arrayEnds ? ` ${rendered}` : `${eol}${indent}${rendered}`;

  if (hasComma) {
    return [edit(file, text, end, end, entry)];
  }
  return end === lastEnd
    ? [edit(file, text, end, end, `,${entry}`)]
    : [edit(file, text, lastEnd, lastEnd, ","), edit(file, text, end, end, entry)];
}

/**
 * Edits appending `value` to the array at the top-level key `collection` of
 * `text`, the contents of `file`, creating the array if it is missing.
 * Throws, with a message for the user, when the file can't take the entry.
 */
export function appendJsonEdits(file: string, text: string, collection: string, value: object): FileEdit[] {
  const doc = parseJsonDoc(text);
  const tree = treeOf(doc);
  const name = path.basename(file);
  if (doc.errors.length > 0 || tree?.type !== "object") {
    throw new Error(`Fix ${name} before adding to its "${collection}"`);
  }
  const array = findNodeAtLocation(tree, [collection]);
  if (array && array.type !== "array") {
    throw new Error(`"${collection}" in ${name} must be an array`);
  }
  const last = array?.children?.at(-1);
  if (last) {
    return insertAfter(file, text, last, value);
  }
  return modify(text, [collection, -1], value, { formattingOptions: jsonFormatting(text) }).map(
    ({ offset, length, content }) => edit(file, text, offset, offset + length, content)
  );
}

/** The direct child of an array/object that contains `node`. */
function containerChild(node: Node): { container: Node; child: Node } | undefined {
  let child = node;
  let container = child.parent;
  if (container?.type === "property") {
    child = container;
    container = child.parent;
  }
  return container && (container.type === "array" || container.type === "object")
    ? { container, child }
    : undefined;
}

/** The comma between two children, excluding comments and whitespace around it. */
function commaBetween(text: string, start: number, end: number): { start: number; end: number } | undefined {
  const scanner = createScanner(text, false);
  scanner.setPosition(start);
  while (scanner.getPosition() < end) {
    const token = scanner.scan();
    if (token === SyntaxKind.CommaToken) {
      return {
        start: scanner.getTokenOffset(),
        end: scanner.getTokenOffset() + scanner.getTokenLength(),
      };
    }
    if (token === SyntaxKind.EOF) {
      break;
    }
  }
  return undefined;
}

/**
 * Extends an entry through its separator and trailing comment, but not through
 * the line break before the container's closing token.
 */
function trailingEntryEnd(text: string, child: Node, container: Node): number {
  const scanner = createScanner(text, false);
  scanner.setPosition(child.offset + child.length);
  let end = child.offset + child.length;
  while (scanner.getPosition() < container.offset + container.length) {
    switch (scanner.scan()) {
      case SyntaxKind.Trivia:
      case SyntaxKind.CommaToken:
      case SyntaxKind.LineCommentTrivia:
      case SyntaxKind.BlockCommentTrivia:
        end = scanner.getTokenOffset() + scanner.getTokenLength();
        break;
      case SyntaxKind.LineBreakTrivia:
      case SyntaxKind.CloseBracketToken:
      case SyntaxKind.CloseBraceToken:
      case SyntaxKind.EOF:
        return end;
      default:
        return end;
    }
  }
  return end;
}

/** Whether `candidate` is inside `ancestor`, including equality. */
function containsNode(ancestor: Node, candidate: Node): boolean {
  return ancestor.offset <= candidate.offset &&
    candidate.offset + candidate.length <= ancestor.offset + ancestor.length;
}

/**
 * Removes JSON array items or object properties containing `values`.
 *
 * Values may overlap (for example, an assessment question and one of its
 * alternatives); the outer removal wins. Unrelated text and comments on kept
 * entries are left byte-for-byte unchanged.
 */
export function removeJsonValues(file: string, text: string, values: readonly Node[]): FileEdit[] {
  const outer = values.filter(
    (value, i) => !values.some((other, j) => i !== j && containsNode(other, value))
  );
  const grouped = new Map<Node, Set<Node>>();
  for (const value of outer) {
    const found = containerChild(value);
    if (!found) {
      throw new Error(`Could not remove JSON value from ${path.basename(file)}`);
    }
    const removed = grouped.get(found.container) ?? new Set<Node>();
    removed.add(found.child);
    grouped.set(found.container, removed);
  }

  const edits: FileEdit[] = [];
  for (const [container, removed] of grouped) {
    const children = container.children ?? [];
    for (let a = 0; a < children.length; a++) {
      if (!removed.has(children[a])) {
        continue;
      }
      let b = a;
      while (b + 1 < children.length && removed.has(children[b + 1])) {
        b++;
      }
      if (b + 1 < children.length) {
        edits.push(edit(file, text, children[a].offset, children[b + 1].offset, ""));
      } else {
        const end = trailingEntryEnd(text, children[b], container);
        if (a > 0) {
          const comma = commaBetween(
            text,
            children[a - 1].offset + children[a - 1].length,
            children[a].offset
          );
          if (comma) {
            const separator = text.slice(comma.end, children[a].offset);
            if (/^\s*$/.test(separator)) {
              edits.push(edit(file, text, comma.start, end, ""));
              a = b;
              continue;
            }
            edits.push(edit(file, text, comma.start, comma.end, ""));
          }
        }
        edits.push(edit(file, text, children[a].offset, end, ""));
      }
      a = b;
    }
  }
  return edits.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
}

/** A value to select in a file once it's open. An index of -1 means the last entry. */
export interface JsonFocus {
  file: string;
  path: JsonPath;
}

/** The offsets of the value at `jsonPath`, inside the quotes of a string, so typing replaces it. */
export function jsonValueRange(text: string, jsonPath: JsonPath): { start: number; end: number } | undefined {
  let node = treeOf(parseJsonDoc(text));
  for (const segment of jsonPath) {
    node = segment === -1 ? node?.children?.at(-1) : node && findNodeAtLocation(node, [segment]);
  }
  if (!node) {
    return undefined;
  }
  const quote = node.type === "string" ? 1 : 0;
  return { start: node.offset + quote, end: node.offset + node.length - quote };
}
