# @sybelblue/prairielearn-navigator

Checks a [PrairieLearn](https://www.prairielearn.com) course for problems that
should fail CI. These are the same diagnostics the
[PrairieLearn Navigator](https://github.com/SybelBlue/prairielearn-navigator)
VS Code extension shows. `check` looks at every `infoAssessment.json` under the given
paths (default: `.`). It reports missing or incomplete questions as errors and
duplicate question IDs as warnings. Only errors make it exit non-zero.

```sh
npx -y @sybelblue/prairielearn-navigator check [--format pretty|github] [paths...]
```

Paths can be glob patterns. A glob that matches a directory searches inside
it. Quote globs so the shell passes them through unexpanded:

```sh
npx -y @sybelblue/prairielearn-navigator check "courseInstances/Fa26/**"
```

Every file it verifies is listed first: each `infoAssessment.json`, followed by
the `info.json` of each question it references (red if that question has an
error). With `--format github` this list is a collapsible log group.

```
courseInstances/Fa26/assessments/hw1/infoAssessment.json
  questions/good/info.json
  questions/topic/nested/info.json
  questions/inlineText/info.json
  questions/noHtml/info.json
  questions/noInfo/info.json
  questions/doesNotExist/info.json

courseInstances/Fa26/assessments/hw1/infoAssessment.json:13:18 error: incomplete question: missing required html file
   |
11 |         { "id": "topic/nested", "points": 1 },
12 |         { "id": "inlineText", "points": 1 },
13 |         { "id": "noHtml", "points": 1 },
   |                  ^^^^^^ incomplete question: missing required html file

3 errors, 2 warnings in 1 file (1 file, 6 questions checked)
```

## GitHub Actions

`--format github` prints workflow annotations, so problems show up inline on
the pull request. Run it from the repository root so annotation paths resolve:

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: 22
- run: npx -y @sybelblue/prairielearn-navigator check --format github
```

Requires Node.js 22 or newer.
