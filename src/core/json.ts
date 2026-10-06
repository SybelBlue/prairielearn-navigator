import {
  findNodeAtLocation,
  getNodeValue,
  JSONPath,
  Node,
  ParseError,
  parseTree,
  printParseErrorCode,
} from "jsonc-parser";

/** A parsed JSON-with-comments document that keeps offsets for every node. */
export interface JsonDoc {
  /** Undefined when the text has no parseable root value. */
  value: unknown;
  tree: Node | undefined;
  errors: { offset: number; length: number; message: string }[];
}

export function parseJsonDoc(text: string): JsonDoc {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  return {
    value: tree ? getNodeValue(tree) : undefined,
    tree,
    errors: errors.map((e) => ({
      offset: e.offset,
      length: e.length,
      message: printParseErrorCode(e.error),
    })),
  };
}

/** Parses JSON with comments, returning undefined if it has syntax errors. */
export function parseJsonc(text: string): unknown {
  const doc = parseJsonDoc(text);
  return doc.errors.length === 0 ? doc.value : undefined;
}

/**
 * Offsets of the value at `path` (or of its property name, with `key`),
 * falling back to its nearest existing ancestor, then to the document start.
 */
export function rangeOf(
  doc: JsonDoc,
  path: JSONPath,
  options: { key?: boolean } = {}
): { startOffset: number; endOffset: number } {
  if (doc.tree) {
    for (let n = path.length; n >= 0; n--) {
      let node = findNodeAtLocation(doc.tree, path.slice(0, n));
      if (node && options.key && n === path.length && node.parent?.type === "property") {
        node = node.parent.children?.[0] ?? node;
      }
      if (node) {
        return { startOffset: node.offset, endOffset: node.offset + node.length };
      }
    }
  }
  return { startOffset: 0, endOffset: 0 };
}

/** Converts a JSON pointer ("/a/0/b") into a path (["a", 0, "b"]). */
export function pointerToPath(pointer: string): JSONPath {
  if (pointer === "") {
    return [];
  }
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}
