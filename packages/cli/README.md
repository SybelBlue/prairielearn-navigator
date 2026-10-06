# @sybelblue/prairielearn-navigator

Checks a [PrairieLearn](https://www.prairielearn.com) course for problems that
should fail CI. These are the same diagnostics the
[PrairieLearn Navigator](https://github.com/SybelBlue/prairielearn-navigator)
VS Code extension shows. `check` looks at every course JSON file
(`infoCourse.json`, `infoCourseInstance.json`, `infoAssessment.json`, and the
`info.json` of questions, elements, and element extensions) under the given
paths (default: `.`). Only errors make it exit non-zero.

```sh
npx -y @sybelblue/prairielearn-navigator check [options] [paths...]
```

| Option | |
| --- | --- |
| `--format pretty\|github` | Output format (default: `pretty`) |
| `--config <path>` | Config file (default: `.pl-navigator.jsonc` in each course root) |
| `--pl-version <version>` | PrairieLearn version to check against (overrides the config) |
| `--schema-cache <dir>` | Where downloaded schemas are cached (overrides the config) |

## Rules

Each diagnostic ends with its rule id, e.g. `[schema]`.

| Rule | Files | Reports |
| --- | --- | --- |
| `json-syntax` | all | JSON syntax errors (comments and trailing commas are allowed) |
| `schema` | all | Violations of PrairieLearn's own JSON schema for the selected version. Unknown properties are warnings. |
| `client-files-course-exist` | question, element, and element extension `info.json` | `clientFilesCourseStyles`/`Scripts` entries that do not exist in `clientFilesCourse/` |
| `duplicate-question-id` | `infoAssessment.json` | Question ids used more than once (warning) |
| `incomplete-question` | `infoAssessment.json` | Question ids with no directory, `info.json`, or `question.html` |

## Configuration

Put a `.pl-navigator.jsonc` (JSON with comments) next to `infoCourse.json`:

```jsonc
{
  // "latest" (default), a date, or a PrairieLearn commit sha
  "plVersion": "2025-06-01",
  // Relative to this file. Default: $XDG_CACHE_HOME/prairielearn-navigator/schemas
  // or ~/.cache/prairielearn-navigator/schemas
  "schemaCacheDir": ".cache/pl-schemas",
  // Turn rules off or change their severity
  "rules": { "duplicate-question-id": "error" }
}
```

PrairieLearn has no numbered releases; it deploys continuously from its
`master` branch. So a version is one of:

- `latest`: today's `master`. Schemas are downloaded at most once a day.
- A date (`YYYY-MM-DD`): `master` as of the end of that day (UTC). The commit is
  looked up once with the GitHub API; set `GITHUB_TOKEN` if you hit its rate
  limit.
- A 40-character commit sha. Fully reproducible, and needs no API call.

Schemas are fetched from GitHub and cached. If they can't be fetched (for
example, offline with an empty cache), schema validation is skipped with a
single warning, and the other rules still run.

Paths can be glob patterns. A glob that matches a directory searches inside
it. Quote globs so the shell passes them through unexpanded:

```sh
npx -y @sybelblue/prairielearn-navigator check "courseInstances/Fa26/**"
```

Every file it verifies is listed first. Each `infoAssessment.json` is followed
by the `info.json` of each question it references (red if that question has an
error). With `--format github` this list is a collapsible log group.

```
courseInstances/Fa26/assessments/hw1/infoAssessment.json
  questions/good/info.json
  questions/topic/nested/info.json
  questions/inlineText/info.json
  questions/noHtml/info.json
  questions/noInfo/info.json
  questions/doesNotExist/info.json

infoCourse.json
questions/deps/info.json
...

courseInstances/Fa26/assessments/hw1/infoAssessment.json:13:18 error: incomplete question: missing required html file [incomplete-question]
   |
11 |         { "id": "topic/nested", "points": 1 },
12 |         { "id": "inlineText", "points": 1 },
13 |         { "id": "noHtml", "points": 1 },
   |                  ^^^^^^ incomplete question: missing required html file [incomplete-question]

questions/deps/info.json:8:48 error: file not found: clientFilesCourse/missing.css [client-files-course-exist]
  |
6 |   "topic": "T",
7 |   "dependencies": {
8 |     "clientFilesCourseStyles": ["exists.css", "missing.css"],
  |                                                ^^^^^^^^^^^ file not found: clientFilesCourse/missing.css [client-files-course-exist]

6 errors, 3 warnings in 3 files (8 files, 6 questions checked)
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
