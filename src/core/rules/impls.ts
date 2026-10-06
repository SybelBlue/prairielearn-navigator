import * as fs from "node:fs";
import * as path from "node:path";
import { Diagnostic } from "../diagnostic";
import { parseJsonc, pointerToPath, rangeOf, strictJsonErrors } from "../json";
import { questionFilePathsFromId } from "../questionPaths";
import { FileRef, findFileRefs } from "../references/extract";
import { RefSpec, TargetKind } from "../references/specs";
import { SchemaName } from "../schemas";
import { RuleContext, RuleImpl } from "./types";

/**
 * Reports JSON syntax errors. PrairieLearn reads course JSON with JSON.parse,
 * so comments and trailing commas fail its sync. (Other rules still read
 * such files tolerantly.)
 */
export const jsonSyntax: RuleImpl = ({ text }) => {
  const seen = new Set<number>();
  const diagnostics: Diagnostic[] = [];
  for (const e of strictJsonErrors(text)) {
    if (seen.has(e.offset)) {
      continue; // one error per position is enough
    }
    seen.add(e.offset);
    const comma = /,\s*$/.exec(text.slice(0, e.offset));
    const range = comma && e.message !== "InvalidCommentToken"
      ? { startOffset: comma.index, endOffset: comma.index + 1 }
      : { startOffset: e.offset, endOffset: e.offset + Math.max(1, e.length) };
    diagnostics.push({
      ...range,
      message:
        e.message === "InvalidCommentToken"
          ? "comments are not allowed: PrairieLearn reads course JSON with JSON.parse"
          : comma
            ? "trailing commas are not allowed: PrairieLearn reads course JSON with JSON.parse"
            : `invalid JSON: ${e.message}`,
      severity: "error",
    });
  }
  return diagnostics;
};

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

function refsOf(ctx: RuleContext, filter: (spec: RefSpec) => boolean): FileRef[] {
  const { relPath, plDate, courseRoot, filePath } = ctx;
  return findFileRefs(ctx, relPath, plDate, { courseRoot, fileDir: path.dirname(filePath) }, filter);
}

function existsAs(target: string, kind: Exclude<TargetKind, "question">): boolean {
  const stat = fs.statSync(target, { throwIfNoEntry: false });
  return kind === "file" ? !!stat?.isFile() : !!stat;
}

/** A missing or incomplete question directory, or undefined if it is fine. */
function questionProblem(
  ref: FileRef & { target: string },
  courseRoot: string
): Omit<Diagnostic, "startOffset" | "endOffset" | "severity"> | undefined {
  const paths = questionFilePathsFromId({ courseId: courseRoot, localId: ref.value });
  const existing = paths.strict();
  if (!existing.dir) {
    return {
      message: `missing question: expected question directory ${paths.dir}`,
      related: [{ path: paths.infoJson, message: "Expected location of info.json" }],
    };
  }
  if (!existing.infoJson) {
    return {
      message: "incomplete question: missing required JSON file",
      related: [{ path: paths.infoJson, message: "Expected location of info.json" }],
    };
  }
  if (!existing.questionHtml) {
    const info = parseJsonc(fs.readFileSync(existing.infoJson, "utf8")) as
      | { options?: { text?: unknown } }
      | undefined;
    if (typeof info?.options?.text !== "string") {
      return {
        message: "incomplete question: missing required html file",
        related: [{ path: paths.questionHtml, message: "Expected location of question.html" }],
      };
    }
  }
  return undefined;
}

/** Reports every reference governed by `rule` whose target is missing or invalid. */
export function referencesExist(rule: string): RuleImpl {
  return (ctx) => {
    const diagnostics: Diagnostic[] = [];
    for (const ref of refsOf(ctx, (s) => s.rule === rule)) {
      const range = { startOffset: ref.startOffset, endOffset: ref.endOffset };
      const severity = ref.spec.severity ?? "error";
      if (ref.target === null) {
        diagnostics.push({ ...range, message: ref.problem ?? `invalid path "${ref.value}"`, severity: "error" });
      } else if (ref.spec.target === "question") {
        const problem = questionProblem(ref as FileRef & { target: string }, ctx.courseRoot);
        if (problem) {
          diagnostics.push({ ...range, ...problem, severity });
        }
      } else if (!existsAs(ref.target, ref.spec.target)) {
        diagnostics.push({
          ...range,
          message: `${ref.spec.target === "file" ? "file" : "file or directory"} not found: ${path.relative(ctx.courseRoot, ref.target)}`,
          severity,
          related: [{ path: ref.target, message: "Expected location of file" }],
        });
      }
    }
    return diagnostics;
  };
}

/** Warns on every occurrence of a question used more than once in a file. */
export const duplicateQuestionIds: RuleImpl = (ctx) => {
  const byId = new Map<string, FileRef[]>();
  for (const ref of refsOf(ctx, (s) => s.target === "question")) {
    byId.set(ref.value, [...(byId.get(ref.value) ?? []), ref]);
  }
  return [...byId.values()]
    .filter((refs) => refs.length > 1)
    .flatMap((refs) =>
      refs.map((ref): Diagnostic => ({
        startOffset: ref.startOffset,
        endOffset: ref.endOffset,
        message: `Duplicate question ID: "${ref.value}" appears ${refs.length} times`,
        severity: "warning",
      }))
    );
};
