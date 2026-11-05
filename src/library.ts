// Relative specifiers carry ".js": they are kept in the published
// declarations, which Node16/NodeNext consumers resolve as ES modules.
export {
  assessmentQuestionRefs,
  type AssessmentQuestionRef,
} from "./core/assessmentQuestionRefs.js";
export { findCourseRoot } from "./core/course.js";
export { parseJsonDoc, strictJsonErrors, type JsonDoc } from "./core/json.js";
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
