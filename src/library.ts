// Relative specifiers carry ".js": they are kept in the published
// declarations, which Node16/NodeNext consumers resolve as ES modules.
export {
  addNouns,
  collectAddValues,
  resolveAddValues,
  stepBack,
  type AddContext,
  type AddField,
  type AddNoun,
  type AddPrompt,
  type AddStep,
  type AddValues,
  type CourseAddition,
} from "./core/additions.js";
export {
  assessmentQuestionRefs,
  type AssessmentQuestionRef,
} from "./core/assessmentQuestionRefs.js";
export {
  assessmentId,
  courseAssessments,
  courseInstances,
  planAssessmentRename,
  type AssessmentRename,
  type CourseAssessment,
} from "./core/assessments.js";
export { findCourseRoot } from "./core/course.js";
export {
  prepareFileChanges,
  type FileChange,
  type FileEdit,
} from "./core/fileEdits.js";
export { parseJsonDoc, strictJsonErrors, type JsonDoc, type JsonPath } from "./core/json.js";
export { appendJsonEdits, jsonValueRange, type JsonFocus } from "./core/jsonEdits.js";
export { today, type IsoDate } from "./core/plVersion.js";
export { indexCourse, type ReferenceIndex, type Use, type UsedNames } from "./core/referenceIndex.js";
export {
  removedFileSuppressionPlan,
  removeNouns,
  type CourseRemoval,
  type RemoveContext,
  type RemoveNoun,
  type RemoveOptions,
} from "./core/removals.js";
export {
  createQuestionFileResolver,
  type QuestionFileDescriptor,
  type QuestionFileProvenance,
  type QuestionFileResolution,
  type QuestionFileResolutionUpdate,
  type QuestionFileResolver,
  type QuestionFileResolverOptions,
  type ResolvedQuestionFile,
} from "./core/questionFileResolver.js";
export {
  courseTags,
  implicitTagColor,
  plBadgeColors,
  plDefaultTag,
  plDefaultTagList,
  type CourseTag,
  type TagInfo,
} from "./core/tags.js";
export { defaultTopic, newQuestionTitle, questionInfo, type NewFile } from "./core/templates.js";
