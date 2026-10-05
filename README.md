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

## Development

Common commands are in the [Makefile](Makefile). Run `make help` to list them:

```sh
make install     # npm ci
make test-all    # lint, CLI tests (Vitest), extension tests (VS Code)
make package     # build a .vsix
make check ARGS="path/to/course"   # run the CLI against a course
```

## Releasing

The extension and the npm CLI (`@sybelblue/prairielearn-navigator`) share one
version. To release, put your notes under `## [Unreleased]` in
[CHANGELOG.md](CHANGELOG.md), then run:

```sh
make publish patch   # or: minor / major
```

This:

1. Checks you're on a clean `main` that matches `origin/main`, and runs lint
   and all tests.
2. Bumps both `package.json` files, dates the CHANGELOG entry, commits, tags
   `vX.Y.Z`, and pushes.
3. Creates the GitHub release, which runs
   [publish-npm.yml](.github/workflows/publish-npm.yml) to stage the CLI on
   npm (with provenance), and waits for that run.
4. Approves the staged npm version with `npm stage approve`, which prompts for
   your 2FA code, then waits until the version is public.
5. Publishes the extension with `vsce publish`, **only once the npm version is
   public**.

Use `make publish patch DRY_RUN=1` to run the checks and print the release
steps without changing anything.

If a step after the push fails, the tag and GitHub release already exist but
the extension isn't published. Fix the problem (for a failed workflow, rerun it
with `gh run rerun <id>`), then run `make publish-vscode` from the release
commit. It approves the staged npm version if needed, then publishes the
extension.

One-time setup:

- `gh auth login`
- `npm login`, needed to approve staged publishes
- `npx vsce login sybelblue`, using a Marketplace personal access token
- On npmjs.com, the package's trusted publisher must be GitHub Actions,
  `SybelBlue/prairielearn-navigator`, workflow `publish-npm.yml`, environment
  `npm`, with stage-publish permission.
