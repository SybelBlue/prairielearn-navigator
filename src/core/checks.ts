import * as fs from "node:fs";
import { CourseId } from "../common";
import { Diagnostic } from "./diagnostic";
import { questionFilePathsFromId } from "./questionPaths";

export const incompleteQuestionDiagnosticCode =
  "prairielearn-navigator-incomplete";

const idPattern = /"id"\s*:\s*"([^"]+)"/g;

/** Unique question ids referenced by an infoAssessment.json, in order. */
export function referencedQuestionIds(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(idPattern), (m) => m[1]))];
}

/** Warns on every occurrence of a question id that appears more than once. */
export function checkDuplicateQuestionIds(text: string): Diagnostic[] {
  const idPositions = new Map<string, number[]>();

  for (const match of text.matchAll(idPattern)) {
    const id = match[1];
    const offset = match.index + match[0].indexOf(id);
    const positions = idPositions.get(id) ?? [];
    positions.push(offset);
    idPositions.set(id, positions);
  }

  const diagnostics: Diagnostic[] = [];
  for (const [id, positions] of idPositions) {
    if (positions.length <= 1) {
      continue;
    }
    for (const offset of positions) {
      diagnostics.push({
        startOffset: offset,
        endOffset: offset + id.length,
        message: `Duplicate question ID: "${id}" appears ${positions.length} times`,
        severity: "warning",
      });
    }
  }
  return diagnostics;
}

/** Errors on question ids whose directory, info.json, or html is missing. */
export function checkIncompleteQuestions(
  text: string,
  courseId: CourseId
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const match of text.matchAll(idPattern)) {
    const localId = match[1];
    const paths = questionFilePathsFromId({ courseId, localId });

    const endOffset = match.index + match[0].length;
    const range = {
      startOffset: endOffset - (localId.length + 1),
      endOffset: endOffset - 1,
    };

    const existingPaths = paths.strict();
    if (!existingPaths.dir) {
      diagnostics.push({
        ...range,
        message: `missing question: expected question directory ${paths.dir}`,
        severity: "error",
        code: incompleteQuestionDiagnosticCode,
        related: [
          { path: paths.infoJson, message: "Expected location of info.json" },
        ],
      });
      continue;
    }
    if (!existingPaths.infoJson) {
      diagnostics.push({
        ...range,
        message: `incomplete question: missing required JSON file`,
        severity: "error",
        code: incompleteQuestionDiagnosticCode,
        related: [
          { path: paths.infoJson, message: "Expected location of info.json" },
        ],
      });
    }
    let hasInlineQuestionText = false;
    if (existingPaths.infoJson) {
      try {
        const info = JSON.parse(
          fs.readFileSync(existingPaths.infoJson, "utf8")
        ) as { options?: { text?: unknown } };
        hasInlineQuestionText = typeof info.options?.text === "string";
      } catch (e) {
        console.error(`prairielearn -- error reading question info.json: ${e}`);
      }
    }
    if (!existingPaths.questionHtml && !hasInlineQuestionText) {
      diagnostics.push({
        ...range,
        message: `incomplete question: missing required html file`,
        severity: "error",
        code: incompleteQuestionDiagnosticCode,
        related: [
          {
            path: paths.questionHtml,
            message: "Expected location of question.html",
          },
        ],
      });
    }
  }

  return diagnostics;
}

/** All checks that apply to an infoAssessment.json file. */
export function checkAssessment(
  text: string,
  courseId: CourseId
): Diagnostic[] {
  return [
    ...checkDuplicateQuestionIds(text),
    ...checkIncompleteQuestions(text, courseId),
  ].sort((a, b) => a.startOffset - b.startOffset);
}
