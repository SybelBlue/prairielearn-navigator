# PrairieLearn Navigator

A prototype VS Code extension that provides definitions and inlay hints for PrairieLearn assessments and questions.

This extension is still experimental and may change or break.

## CLI

The extension's diagnostics are also published as a CLI,
[`@sybelblue/prairielearn-navigator`](packages/cli/README.md), so a course
repo can fail CI on them:

```sh
npx -y @sybelblue/prairielearn-navigator check --format github
```

See [packages/cli/README.md](packages/cli/README.md) for options and a GitHub
Actions example.

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
