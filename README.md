# PrairieLearn Navigator

A prototype VS Code extension that provides definitions and inlay hints for PrairieLearn assessments and questions.

This extension is still experimental and may change or break.

## CLI

The extension's diagnostics are also available as a CLI, so a course repo can
fail CI on them. `check` looks at every `infoAssessment.json` under the given
paths (default: `.`). It reports missing or incomplete questions as errors and
duplicate question IDs as warnings. Only errors make it exit non-zero.

```sh
npx -y github:SybelBlue/prairielearn-navigator check [--format pretty|github] [paths...]
```

Paths can be glob patterns. A glob that matches a directory searches inside
it. Quote globs so the shell passes them through unexpanded:

```sh
npx -y github:SybelBlue/prairielearn-navigator check "courseInstances/Fa26/**"
```

```
courseInstances/Fa26/assessments/hw1/infoAssessment.json:13:18 error: incomplete question: missing required html file
   |
11 |         { "id": "topic/nested", "points": 1 },
12 |         { "id": "inlineText", "points": 1 },
13 |         { "id": "noHtml", "points": 1 },
   |                  ^^^^^^ incomplete question: missing required html file

3 errors, 2 warnings in 1 file (1 file checked)
```

### GitHub Actions

`--format github` prints workflow annotations, so problems show up inline on
the pull request. Run it from the repository root so annotation paths resolve:

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: 22
- run: npx -y github:SybelBlue/prairielearn-navigator check --format github
```

Requires Node.js 22 or newer.

## Test, bundle, and publish

Run the extension tests and checks:

```sh
npm test
```

Run the editor-independent core and CLI tests (no VS Code needed):

```sh
npm run test:cli
```

Build a production bundle, rerun the checks, and create a `.vsix` file:

```sh
npm run bundle
```

To publish a new version to the Visual Studio Marketplace, create a Marketplace
publisher access token, export it as `VSCE_PAT`, and choose the appropriate
semantic-version increment:

```sh
VSCE_PAT=your-token npm run publish:vscode:patch
# or: publish:vscode:minor / publish:vscode:major
```

Each publish command runs the tests first. To publish the version already set in
`package.json` without incrementing it, use `npm run publish:vscode`.
