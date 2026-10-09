# Change Log

All notable changes to the "prairielearn-navigator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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
