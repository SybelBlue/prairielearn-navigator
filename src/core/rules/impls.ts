import * as fs from "node:fs";
import * as path from "node:path";
import { checkDuplicateQuestionIds, checkIncompleteQuestions } from "../checks";
import { Diagnostic } from "../diagnostic";
import { pointerToPath, rangeOf } from "../json";
import { findFileRefs, RefKind } from "../references";
import { SchemaName } from "../schemas";
import { RuleImpl } from "./types";

/** Reports JSON syntax errors (comments and trailing commas are allowed). */
export const jsonSyntax: RuleImpl = ({ doc }) =>
  doc.errors.map((e) => ({
    startOffset: e.offset,
    endOffset: e.offset + Math.max(1, e.length),
    message: `invalid JSON: ${e.message}`,
    severity: "error",
  }));

/** Validates the file against PrairieLearn's JSON schema for the PL version. */
export function schemaRule(name: SchemaName): RuleImpl {
  return async ({ doc, schemas, plVersion }) => {
    if (doc.errors.length > 0 || doc.value === undefined) {
      return []; // jsonSyntax reports these
    }
    const schema = await schemas.get(name, plVersion);
    if (!schema || schema.validate(doc.value)) {
      return [];
    }

    const seen = new Set<string>();
    const diagnostics: Diagnostic[] = [];
    for (const err of schema.validate.errors ?? []) {
      let jsonPath = pointerToPath(err.instancePath);
      let message = `${err.instancePath || "root"} ${err.message}`;
      let severity: Diagnostic["severity"] = "error";
      if (err.keyword === "additionalProperties") {
        // Newer PL versions may accept properties an older pinned schema lacks
        const prop = String(err.params.additionalProperty);
        jsonPath = [...jsonPath, prop];
        message = `unknown property "${prop}"`;
        severity = "warning";
      } else if (err.keyword === "enum") {
        message += `: ${(err.params.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(", ")}`;
      }
      const key = `${jsonPath.join("/")}\0${message}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      let range = rangeOf(doc, jsonPath);
      if (err.keyword === "required") {
        // Point at the opening brace rather than the whole object
        range = { startOffset: range.startOffset, endOffset: range.startOffset + 1 };
      }
      diagnostics.push({
        ...range,
        message: `${message} (PL schema ${schema.label})`,
        severity,
      });
    }
    return diagnostics;
  };
}

/** Errors on file references of the given kinds whose target does not exist. */
export function referencesExist(kinds: readonly RefKind[]): RuleImpl {
  return ({ doc, relPath, plDate, courseRoot, filePath }) => {
    const fileDir = path.dirname(filePath);
    return findFileRefs(doc, relPath, plDate, { courseRoot, fileDir }, kinds)
      .filter((ref) => ref.target === null || !fs.existsSync(ref.target))
      .map((ref): Diagnostic => {
        const range = { startOffset: ref.startOffset, endOffset: ref.endOffset };
        if (ref.target === null) {
          return {
            ...range,
            message: `"${ref.value}" must be a path inside ${ref.kind}/`,
            severity: "error",
          };
        }
        return {
          ...range,
          message: `file not found: ${path.relative(courseRoot, ref.target)}`,
          severity: "error",
          related: [{ path: ref.target, message: "Expected location of file" }],
        };
      });
  };
}

export const duplicateQuestionIds: RuleImpl = ({ text }) =>
  checkDuplicateQuestionIds(text);

export const incompleteQuestions: RuleImpl = ({ text, courseRoot }) =>
  checkIncompleteQuestions(text, courseRoot);
