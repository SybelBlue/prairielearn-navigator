import { courseFiles } from "../courseFiles";
import {
  duplicateQuestionIds,
  incompleteQuestions,
  jsonSyntax,
  referencesExist,
  schemaRule,
} from "./impls";
import { RuleTable } from "./types";

/**
 * Every validation rule, by id. Each entry is
 * `[plVersionRange, courseRelativeGlob, impl]`, and for a given file the
 * first entry whose range and glob both match is the one that runs.
 *
 * To change a rule for newer PL versions, add an entry with a narrower
 * range above the existing one, e.g.
 *   [">=2026-01-01", courseFiles.question, newImpl],
 *   ["*",            courseFiles.question, oldImpl],
 *
 * Ids appear in diagnostic codes as `prairielearn-navigator/<id>` and are the
 * keys of the `rules` config setting.
 */
export const rules = {
  "json-syntax": Object.values(courseFiles).map((files) => ["*", files, jsonSyntax] as const),

  "schema": [
    ["*", courseFiles.course, schemaRule("infoCourse")],
    ["*", courseFiles.courseInstance, schemaRule("infoCourseInstance")],
    ["*", courseFiles.assessment, schemaRule("infoAssessment")],
    ["*", courseFiles.question, schemaRule("infoQuestion")],
    ["*", courseFiles.element, schemaRule("infoElementCourse")],
    ["*", courseFiles.elementExtension, schemaRule("infoElementExtension")],
  ],

  "client-files-course-exist": [
    ["*", courseFiles.question, referencesExist(["clientFilesCourse"])],
    ["*", courseFiles.element, referencesExist(["clientFilesCourse"])],
    ["*", courseFiles.elementExtension, referencesExist(["clientFilesCourse"])],
  ],

  "duplicate-question-id": [
    ["*", courseFiles.assessment, duplicateQuestionIds],
  ],

  "incomplete-question": [
    ["*", courseFiles.assessment, incompleteQuestions],
  ],
} as const satisfies RuleTable;

export type RuleId = keyof typeof rules;

export function isRuleId(id: string): id is RuleId {
  return Object.hasOwn(rules, id);
}

export function ruleDiagnosticCode(id: RuleId): string {
  return `prairielearn-navigator/${id}`;
}
