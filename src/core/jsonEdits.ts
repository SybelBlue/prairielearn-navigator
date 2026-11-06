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
