import { courseFiles } from "../courseFiles";
import { refSpecs, RefRuleId } from "../references/specs";
import {
  duplicateQuestionIds,
  jsonSyntax,
  referencesExist,
  schemaRule,
} from "./impls";
import { RuleEntry, RuleTable } from "./types";

/**
 * Rules that are not about file references, by id. Each entry is
 * `[plVersionRange, courseRelativeGlob, impl]`, and for a given file the
 * first entry whose range and glob both match is the one that runs.
 *
 * To change a rule for newer PL versions, add an entry with a narrower
 * range above the existing one, e.g.
 *   [">=2026-01-01", courseFiles.question, newImpl],
 *   ["*",            courseFiles.question, oldImpl],
 */
const otherRules = {
  "json-syntax": Object.values(courseFiles).map((files) => ["*", files, jsonSyntax] as const),

  "schema": [
    ["*", courseFiles.course, schemaRule("infoCourse")],
    ["*", courseFiles.courseInstance, schemaRule("infoCourseInstance")],
    ["*", courseFiles.assessment, schemaRule("infoAssessment")],
    ["*", courseFiles.question, schemaRule("infoQuestion")],
    ["*", courseFiles.element, schemaRule("infoElementCourse")],
    ["*", courseFiles.elementExtension, schemaRule("infoElementExtension")],
  ],

  "duplicate-question-id": [
    ["*", courseFiles.assessment, duplicateQuestionIds],
  ],
} as const satisfies RuleTable;

/**
 * One existence rule per `rule` named in references/specs.ts, applying to
 * every file its specs read. Version ranges live on the specs themselves.
 */
function referenceRules(): Record<RefRuleId, RuleEntry[]> {
  const out = {} as Record<RefRuleId, RuleEntry[]>;
  for (const spec of refSpecs) {
    const entries = (out[spec.rule] ??= []);
    if (!entries.some(([, files]) => files === spec.files)) {
      entries.push(["*", spec.files, referencesExist(spec.rule)]);
    }
  }
  return out;
}

/**
 * Every validation rule, by id. Ids appear in diagnostic codes as
 * `prairielearn-navigator/<id>` and are the keys of the `rules` setting.
 */
export const rules: Record<RuleId, readonly RuleEntry[]> = {
  ...otherRules,
  ...referenceRules(),
};

export type RuleId = keyof typeof otherRules | RefRuleId;

export function isRuleId(id: string): id is RuleId {
  return Object.hasOwn(rules, id);
}

export function ruleDiagnosticCode(id: RuleId): string {
  return `prairielearn-navigator/${id}`;
}
