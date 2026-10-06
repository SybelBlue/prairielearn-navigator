# Change Log

All notable changes to the "prairielearn-navigator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Validate all course JSON files against PrairieLearn's JSON schemas for a
  chosen PrairieLearn version: `latest`, a date, or a commit sha. Schemas are
  downloaded from GitHub and cached.
- New `.pl-navigator.jsonc` course config: `plVersion`, `schemaCacheDir`, and
  per-rule `off`/`warning`/`error`. In VS Code, `.vscode/settings.json` takes
  precedence over it.
- New rule: `clientFilesCourseStyles`/`Scripts` dependencies must exist.
- New rule: static `<pl-figure>` files in `question.html` must exist, with a
  valid `directory`. `<pl-figure>` file names also jump to the file.
- Jump to file from every file-valued JSON field (question ids,
  `clientFilesCourse*`, `clientFilesQuestion*`, element files).
- CLI: checks every course JSON file, not just `infoAssessment.json`; new
  `--config`, `--pl-version`, `--schema-cache` options; diagnostics end with
  their rule id.
- Course JSON with comments no longer breaks checks or tag completion.

## [0.3.1] - 2026-10-05

- Initial release