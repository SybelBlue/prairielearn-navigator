import { RuleId } from "../core/rules/registry";

/** Dedicated VS Code severity setting for every built-in rule. */
export const vscodeRuleSettings = {
  "json-syntax": "diagnostics.json-syntax",
  schema: "diagnostics.schema",
  "duplicate-question-id": "diagnostics.duplicate-question-id",
  "unused-question": "diagnostics.unused-question",
  "unused-tag": "diagnostics.unused-tag",
  "unused-assessment-set": "diagnostics.unused-assessment-set",
  "question-info-missing": "diagnostics.question-info-missing",
  "client-files-course-exist": "diagnostics.client-files-course-exist",
  "client-files-question-exist": "diagnostics.client-files-question-exist",
  "server-files-course-exist": "diagnostics.server-files-course-exist",
  "question-exists": "diagnostics.question-exists",
  "element-files-exist": "diagnostics.element-files-exist",
  "pl-figure-file-exist": "diagnostics.pl-figure-file-exist",
  "pl-file-download-file-exist": "diagnostics.pl-file-download-file-exist",
  "pl-code-file-exist": "diagnostics.pl-code-file-exist",
  "pl-file-editor-file-exist": "diagnostics.pl-file-editor-file-exist",
  "pl-graph-file-exist": "diagnostics.pl-graph-file-exist",
  "pl-rich-text-editor-file-exist": "diagnostics.pl-rich-text-editor-file-exist",
  "pl-excalidraw-file-exist": "diagnostics.pl-excalidraw-file-exist",
  "pl-xss-safe-file-exist": "diagnostics.pl-xss-safe-file-exist",
  "pl-template-file-exist": "diagnostics.pl-template-file-exist",
} as const satisfies Record<RuleId, string>;

/** Setting names published before the uniform diagnostics.* settings. */
export const legacyVscodeRuleSettings = {
  "unused-question": "unusedQuestions",
  "unused-tag": "unusedTags",
  "unused-assessment-set": "unusedAssessmentSets",
  "question-info-missing": "missingQuestionInfo",
} as const satisfies Partial<Record<RuleId, string>>;
