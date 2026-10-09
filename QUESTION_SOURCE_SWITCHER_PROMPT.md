# Task: add question source-switch buttons to PrairieLearn Navigator

Implement quick source-file switching in the PrairieLearn Navigator VS Code extension.

## Goal

When the active editor contains a file belonging to a discovered PrairieLearn question, show three icon buttons in the editor title bar:

1. `question.html` — use the VS Code code icon (`$(code)`, visually `</>`).
2. `info.json` — use the VS Code JSON icon (`$(json)`, visually curly braces).
3. `server.py` — use a recognizable Python icon. Add small light/dark 16×16 SVG assets if there is no suitable built-in codicon.

Clicking a button opens that sibling file for the same question in the active editor group.

The button corresponding to the file already open must remain visible but be disabled, so VS Code renders it grey. For example, while editing `question.html`, the HTML button is visible and disabled while the JSON and Python buttons remain available.

## Required behavior

- Treat an editor as belonging to a question only when its `file:` URI is inside the directory of a question known to `QuestionCache`. Confirm the question through the discovered cache/`info.json`; do not enable the controls merely because a path happens to contain a `questions` segment.
- Support nested QIDs such as `questions/topic/nested/`. If known question directories overlap, use the deepest matching directory.
- Show the buttons for the canonical files and for other files inside the detected question directory, including files in `clientFilesQuestion/`. When a noncanonical question file is active, none of the three buttons is disabled solely because of the current filename.
- Keep all three buttons visible for a detected question. Since `question.html` and `server.py` can be absent, disable/grey a target whose file does not exist as well as the target representing the currently active canonical file. `info.json` should exist by definition for a discovered question.
- Recompute button state on activation, active-editor changes, and relevant question-cache/file changes so adding or deleting `question.html` or `server.py` updates the controls without reloading the window.
- Commands must resolve the active question again when invoked rather than relying on stale captured state. Guard the handler too: direct/programmatic invocation for the current file or a missing target should be a safe no-op (or show a concise informational message for a missing target), even though normal UI invocation is disabled.
- Opening a source file must not create a missing file implicitly.
- Do not change the CLI behavior or introduce `vscode` dependencies under `src/core`, `src/cli`, or `src/test-cli`.

## Repository-specific implementation guidance

Start by reading these existing pieces and reuse them rather than creating a second question model:

- `src/core/questionPaths.ts`: `questionFilePathsFromId()` already provides `dir`, `infoJson`, `questionHtml`, `serverPy`, and `strict()`.
- `src/filewatchers/questionCache.ts`: `getQuestionIds()` exposes discovered questions and `QuestionCache.questionFilePathsFromId()` delegates to the path helper.
- `src/commands.ts`: `commands.openFile()` is the established file-opening behavior.
- `src/extension.ts`: constructs `CourseCache`/`QuestionCache`, registers commands/providers, and owns extension subscriptions.
- `package.json`: currently contains command and menu contributions but no `editor/title` menu.

A clean implementation would put the active-question resolution, context updates, and three switch commands in a small extension-only module or class, then instantiate/register it from `activate()` after `QuestionCache` exists. Ensure every event listener and emitter is disposed through `context.subscriptions`.

Use VS Code context keys to control visibility and enablement. Suggested state:

- `prairielearn-navigator.inQuestion`
- `prairielearn-navigator.currentQuestionFile` with values such as `questionHtml`, `infoJson`, `serverPy`, or an empty value
- one existence key per target, such as `prairielearn-navigator.questionHtmlExists` and `prairielearn-navigator.serverPyExists`

Contribute the three commands in `package.json` with command-level `enablement` clauses. The `editor/title` menu entries should use a `when` clause only to decide whether the buttons are shown for a detected question. The command `enablement` must combine target existence with `currentQuestionFile != ...`; this distinction is what keeps the active file’s icon visible but greyed out instead of removing it. Put all three entries in the `navigation` group in HTML, JSON, Python order.

Do not call `CourseCache.getQuestionIdFor()` blindly for arbitrary nested files: its current implementation derives the QID by dropping only the final path component, which is correct for canonical root files but not for `clientFilesQuestion/foo.js`. Resolve against the directories of the known IDs from `QuestionCache`, using `path.relative()` (or an equivalent platform-safe containment check) and selecting the longest/deepest match.

Suggested command IDs:

- `prairielearn-navigator.openQuestionHtml`
- `prairielearn-navigator.openQuestionInfoJson`
- `prairielearn-navigator.openQuestionServerPy`

Use clear titles/tooltips: `Open question.html`, `Open info.json`, and `Open server.py`.

## Tests and documentation

Extend `src/test/extension.test.ts` and its fixtures to cover at least:

- Opening each sibling source file from another canonical question file.
- Resolving a nested QID correctly.
- Resolving from a file below `clientFilesQuestion/` to the containing question.
- A command for the already active canonical file leaves the editor unchanged.
- A missing optional target is not created or opened.
- A non-question file does not resolve to a question.

Also add a focused assertion over the command/menu contributions (or otherwise verify the manifest) so regressions in the `editor/title`, `when`, and `enablement` wiring are caught. The test should specifically protect the requirement that the current-file action is disabled rather than hidden.

Document the feature briefly in `README.md` and add it under `## [Unreleased]` in `CHANGELOG.md`.

Run the repository’s normal formatting/linting and full validation, preferably:

```sh
make test-all
```

Also build/package far enough to confirm any custom Python SVG assets are included in the VSIX.

## Acceptance criteria

- A detected question file shows HTML, JSON, and Python buttons in the editor title bar.
- Each available button opens the corresponding file from the same question.
- The button matching the active canonical file stays visible and is disabled/grey.
- Missing optional sibling files are also visibly unavailable and are never created by navigation.
- Nested questions, multi-root workspaces, and files below a question directory resolve to the correct question.
- Context state clears immediately when focus moves to a non-question editor.
- Lint, builds, CLI tests, and VS Code extension tests pass.
