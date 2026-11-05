# Change Log

All notable changes to the "prairielearn-navigator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- The npm library exports the course logic the CLI and extension use: `findCourseRoot`, `parseJsonDoc`,
  `strictJsonErrors`, `courseTags`, `plDefaultTag`, `plDefaultTagList`,
  `plBadgeColors` (now frozen), `implicitTagColor`, and the new
  `assessmentQuestionRefs`, which lists an assessment's question and
  alternative ids with their offsets. Types `JsonDoc`, `TagInfo`, `CourseTag`
  and `AssessmentQuestionRef` are exported too, and the package's declarations
  now cover the whole library entry point.

## [1.2.5] - 2026-11-05

- Find All References on a tag defined in `infoCourse.json`, either on its
  definition or in a question's `info.json`, lists the definition and every
  question's `tags` entry naming it. On a tag, the question's assessments are
  no longer listed as uses of its `info.json`.
- Hovering an assessment's `set` in `infoAssessment.json` shows the badge
  PrairieLearn draws for the assessment (the set's abbreviation and the
  assessment's number, in the set's color) and the set's heading;
  go-to-definition jumps to the set in `infoCourse.json`. PrairieLearn's
  default sets show their built-in abbreviation, color, and heading.
- New `undefined-assessment-set` rule (info) for an assessment's `set` that
  `infoCourse.json` doesn't define and PrairieLearn has no default for, with a
  quick fix that defines the set as PrairieLearn would (`gray1`, with the name
  as abbreviation and heading) and selects its abbreviation to change.
- Rename Symbol (F2) on an assessment set defined in `infoCourse.json`, either
  on its definition or in an assessment's `set`, renames it across the course:
  the definition, every assessment's `set`, and `.pl-navigator.jsonc`
  suppressions that name it. Undefined sets, and new names `infoCourse.json`
  already defines, are refused.
- New `rename-assessment-sets` CLI command that previews or writes the same
  assessment set rename.
- Find All References on a defined assessment set, either on its definition or
  in an assessment, lists the definition and every assessment's `set` naming
  it.
- An assessment's `set` completes the assessment sets `infoCourse.json`
  defines, then PrairieLearn's default sets it doesn't redefine.

## [1.2.4] - 2026-11-04

- Rename Symbol (F2) on a tag defined in `infoCourse.json`, either on its
  definition or in a question's `info.json`, renames it across the course: the
  definition, every question's `tags` entry, and `.pl-navigator.jsonc`
  suppressions that name it. A question that already lists the new name drops
  the old one instead of duplicating it. Undefined tags, and new names
  `infoCourse.json` already defines, are refused.
- New `rename-tags` CLI command that previews or writes the same tag rename.
- Marketplace releases now publish from GitHub Actions with trusted publishing
  (short-lived OIDC credentials) instead of a locally stored personal access
  token. `make publish` dispatches the new `publish-vscode.yml` workflow once
  the npm version is public, and `make publish-vscode` can now resume from
  `main` instead of only from the release commit.

## [1.2.3] - 2026-11-04

- Hovering a tag in a question's `info.json` shows its color, as PrairieLearn's
  badge, and its description; go-to-definition jumps to the tag in
  `infoCourse.json`. PrairieLearn's default tags show their built-in color and
  description.
- New `undefined-tag` rule (info) for question tags that `infoCourse.json`
  doesn't define and PrairieLearn has no default for, with a quick fix that
  defines the tag.

## [1.2.2] - 2026-10-30

- Added a `rename-qids` CLI command that previews or writes bulk semantic QID
  reference updates for assessments, alternatives, and question templates.
- Moving or renaming question folders in VS Code now offers to update affected
  QID references as part of the same undoable operation.

## [1.2.1] - 2026-10-29

- Broad perf improvements to single and bulk actions.

## [1.2.0] - 2026-10-29

- Optimize build sizes by using webpack.

## [1.1.3] - 2026-10-29

- Every built-in rule now has a dedicated
  `prairielearn-navigator.diagnostics.<rule-id>` VS Code severity dropdown with
  `default`, `off`, `info`, `warning`, and `error` choices. The four severity
  settings added in 1.1.2 remain supported as deprecated aliases.
- Every rule diagnostic now offers quick fixes to ignore that exact occurrence
  in its file through `.pl-navigator.jsonc`, or open the rule's VS Code severity
  setting. Unused diagnostics use stable question ids, tag names, or
  assessment-set names instead of positional fingerprints; other rules fall
  back to exact message/occurrence matching. The CLI honors the same
  `ignoredDiagnostics` suppressions.
- Unused-question, tag, and assessment-set diagnostics now offer removal quick
  fixes. Tags and sets use undoable JSON edits; question directories require
  confirmation and are moved to Trash.

## [1.1.2] - 2026-10-29

- New `unused-question` rule: a question that no assessment uses gets a
  diagnostic on its `info.json` title. Its severity is set by
  `unusedQuestions` (`ignored`, `info`, `warning`, or `error`; default
  `info`) in `.pl-navigator.jsonc`, the `prairielearn-navigator.unusedQuestions`
  setting, or the CLI's `--unused-questions`.
- New `unused-tag` and `unused-assessment-set` rules: a tag that no question
  uses, or an assessment set that no assessment uses, gets a diagnostic on its
  `name` in `infoCourse.json`. Their severities are set by `unusedTags` and
  `unusedAssessmentSets` (same levels; default `warning`), the matching
  `prairielearn-navigator.*` settings, or the CLI's `--unused-tags` and
  `--unused-assessment-sets`.
- New `question-info-missing` rule: a directory in `questions/` that has
  files but no `info.json`, and no question below it, is an error, since
  PrairieLearn fails to load it from disk. It is shown on the directory's
  `question.html`, or else its first file. Its severity is set by
  `missingQuestionInfo` (same levels; default `error`), the matching
  `prairielearn-navigator.missingQuestionInfo` setting, or the CLI's
  `--missing-question-info`.
- Rules can now be set to `info`. The CLI prints infos and counts them in its
  summary, and `--format github` emits them as notices. They don't affect the
  exit code.

## [1.1.1] - 2026-10-27

- Added action-style UUID completion for `uuid` fields in PrairieLearn info
  files, including automatic suggestions in empty values and a quick fix for a
  missing or invalid root UUID. The generator defaults to `uuidgen` and can be
  changed with the `prairielearn-navigator.uuidCommand` setting.

## [1.1.0] - 2026-10-09

- Added a typed, headless `createQuestionFileResolver` npm API that reports
  normalized question-local, inherited-template, and course-level file usage,
  partial-resolution diagnostics, and incrementally affected QIDs.
- The npm package now publishes an ESM library entrypoint and declarations
  alongside the existing CLI.

## [1.0.1] - 2026-10-09

- Added editor-title buttons for quickly switching among a PrairieLearn
  question's `question.html`, `info.json`, and `server.py` source files.
- The release pipeline now opens npm's Staged Packages page for browser-based
  approval and waits for an explicit publish check before releasing to the VS
  Code Marketplace.

## [1.0.0] - 2026-10-06

- Validate all course JSON files against PrairieLearn's JSON schemas for a
  chosen PrairieLearn version: `latest`, a date, or a commit sha. Schemas are
  downloaded from GitHub and cached.
- New `.pl-navigator.jsonc` course config: `plVersion`, `schemaCacheDir`, and
  per-rule `off`/`warning`/`error`. In VS Code, `.vscode/settings.json` takes
  precedence over it.
- Every file a course names must exist: question ids and templates,
  `clientFilesCourse*`, `clientFilesQuestion*`, and `clientFiles` dependencies,
  external grading `serverFilesCourse` entries, element controllers and
  dependencies, and the source files of `pl-figure`, `pl-file-download`,
  `pl-code`, `pl-file-editor`, `pl-graph`, `pl-rich-text-editor`,
  `pl-excalidraw`, `pl-xss-safe`, and `pl-template`.
- `excludes`: glob patterns of files never to check, in `.pl-navigator.jsonc`,
  the `prairielearn-navigator.excludes` setting, or the CLI's `--exclude`.
- For each of those references: jump to the file, Find All References, a
  "N uses" CodeLens on referenced files, and a Find Uses of File command.
- CLI: checks every course JSON file, not just `infoAssessment.json`; new
  `--config`, `--pl-version`, `--schema-cache` options; diagnostics end with
  their rule id.
- Comments and trailing commas in course JSON are reported as errors, since
  PrairieLearn rejects them, and no longer break other checks or tag
  completion.

## [0.3.1] - 2026-10-05

- Initial release
