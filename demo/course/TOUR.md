# PrairieLearn Navigator tour

This window runs the development build of the extension against a small demo
course. Every problem in it is deliberate. Open **Problems** (⇧⌘M / Ctrl+Shift+M)
to see them all: the whole course is checked on startup, not just open files.

## Diagnostics

| Open | You should see |
| --- | --- |
| `courseInstances/Fall2026/assessments/hw1/infoAssessment.json` | `noHtml` has no question.html, `doesNotExist` has no directory, `addNumbers` is used twice. Use the 💡 quick fix on `noHtml` to create the missing file. |
| `questions/brokenJson/info.json` | A comment and a trailing comma (PrairieLearn's `JSON.parse` rejects both), a schema type error, and a misspelled property. |
| `questions/addNumbers/info.json` | `missing-hint.js` is not in `clientFilesQuestion/`. |
| `questions/autograded/info.json` | `shared-tests.py` is not in `serverFilesCourse/`; the `grader/` directory is fine. |
| `questions/elementTour/question.html` | A missing `pl-figure`, an invalid `directory`, and a missing `pl-code` source. The dynamic figure and the `{{templated}}` one in addNumbers are skipped. |
| `elements/demo-element/info.json` | `demo-element.css` does not exist. |

## Jump to file

Cmd/Ctrl-click, or F12 on:

- any question id in `hw1/infoAssessment.json` (opens its question.html, or
  its info.json when there is none), including the `alternatives`;
- `"template": "addNumbers"` in `questions/variant/info.json`;
- `styles.css`, `hint.js`, and `grader/` in the questions' info.json files;
- every file name in `questions/elementTour/question.html`;
- `controller`, element files, and `plot-helpers.js` in the element's info.json.

## Find uses

- Open `clientFilesCourse/styles.css`: the **uses** CodeLens at the top lists
  its four uses: two questions' dependencies, the element, and a `pl-figure`.
- Shift+F12 (Find All References) on `"styles.css"` in any info.json.
- Right-click `questions/elementTour/clientFilesQuestion/graph.png` in the
  Explorer → **PrairieLearn: Find Uses of File** (works for images).
- Open `questions/addNumbers/question.html`: the header CodeLens lists the
  assessments using the question.

## Configuration

- `.pl-navigator.jsonc` pins the PrairieLearn version and schema cache (the
  same file the CLI reads). Hover its keys for documentation.
- Add `"prairielearn-navigator.rules": { "duplicate-question-id": "error" }`
  to this folder's `.vscode/settings.json`. Workspace settings override the
  course file, and diagnostics update immediately.
- **PrairieLearn: Reload Schemas and Config** retries schema downloads, e.g.
  after setting `"plVersion": "latest"`.

## Same checks from the terminal

From the repository root, run the CLI over the whole demo course, as CI
would. It lists the same problems as the Problems panel:

```sh
demo/check.sh                    # code frames for every problem
demo/check.sh --format github    # GitHub Actions annotations
```
