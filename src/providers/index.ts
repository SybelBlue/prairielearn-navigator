export {
  AssessmentCompletionItemProvider,
  isEmptyUuidValue,
  QuestionCompletionItemProvider,
  UuidCompletionItemProvider,
} from "./completions";
export { ConfigProvider } from "./config";
export {
  defineAssessmentSet,
  defineTag,
  DiagnosticQuickFixProvider,
  diagnosticRuleId,
  ignoreDiagnostic,
  removeUnusedQuestion,
} from "./diagnosticActions";
export {
  addGeneratedUuid,
  invalidRootUuidDiagnosticCode,
  missingRootUuidDiagnosticCode,
  MissingFileQuickFixProvider,
  RuleDiagnosticCollection,
} from "./diagnostics";
export {
  anyFileSelector,
  FileReferenceProvider,
  fileReferenceSelector,
  findUsesCommand,
} from "./fileReferences";
export {
  AssessmentQuestionIdCodeLensProvider,
  QuestionHeaderCodeLensProvider,
  CourseHeaderCodeLensProvider,
  CourseInstanceHeaderCodeLensProvider,
} from "./lenses";
export { CourseTagProvider, TagProvider } from "./tags";
export {
  prepareQidRenameWorkspaceEdit,
  qidRenamesForFileMoves,
  registerQidRenameParticipant,
} from "./qidRenames";
