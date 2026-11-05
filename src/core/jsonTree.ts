import { Node } from "jsonc-parser";
import type { JsonDoc } from "./json";

/**
 * The jsonc-parser tree of a document. `JsonDoc.tree` is opaque so the
 * published declarations don't depend on jsonc-parser; this is the one place
 * that reads it back.
 */
export function treeOf(doc: JsonDoc): Node | undefined {
  return doc.tree as Node | undefined;
}
