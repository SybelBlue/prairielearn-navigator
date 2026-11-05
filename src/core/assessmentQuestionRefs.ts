import { RefContext } from "./references/bases";
import { findFileRefs, sourceOf } from "./references/extract";
import { RefSpec } from "./references/specs";

/** A question an infoAssessment.json names. */
export interface AssessmentQuestionRef {
  /** The QID, as written. */
  id: string;
  /** `zones[*].questions[*].id`, or `zones[*].questions[*].alternatives[*].id`. */
  kind: "question" | "alternative";
  /** Offsets of the id, excluding its quotes. */
  startOffset: number;
  endOffset: number;
}

/** The reference specs read, by spec id. */
const kinds: Readonly<Record<string, AssessmentQuestionRef["kind"]>> = {
  "assessment.question": "question",
  "assessment.alternative": "alternative",
};

// Both specs apply to every PrairieLearn version (range "*") and only read
// the JSON, so any assessment path, date, and directories will do. Targets
// are resolved with path arithmetic alone and are ignored here.
const assessmentPath = "courseInstances/instance/assessments/assessment/infoAssessment.json";
const anyDate = "2000-01-01";
const anyContext: RefContext = { courseRoot: "/", fileDir: "/" };
const isQuestionSpec = (spec: RefSpec) => Object.hasOwn(kinds, spec.id);

/**
 * Every question and alternative id in an infoAssessment.json's text, in
 * document order, duplicates included. Comments and trailing commas are
 * allowed; on other syntax errors, returns the ids the parser recovers.
 * Reads the same references as the question-exists rule and QID renames.
 */
export function assessmentQuestionRefs(text: string): AssessmentQuestionRef[] {
  return findFileRefs(sourceOf(text), assessmentPath, anyDate, anyContext, isQuestionSpec).map((ref) => ({
    id: ref.value,
    kind: kinds[ref.spec.id],
    startOffset: ref.startOffset,
    endOffset: ref.endOffset,
  }));
}
