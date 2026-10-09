# PrairieLearn Navigator

A prototype VS Code extension that provides definitions and inlay hints for PrairieLearn assessments and questions.

This extension is still experimental and may change or break.

## Features

- Diagnostics for course files: PrairieLearn schema validation for a chosen
  PrairieLearn version; missing, incomplete, and duplicate questions; and every
  file a course names that doesn't exist (see the
  [rules](packages/cli/README.md#rules)).
- For every one of those file references:
  - **jump to the file**: go-to-definition and Ctrl/Cmd-click;
  - **find its uses**: Find All References on a reference or inside the
    referenced file, a "N uses" CodeLens at the top of referenced files, and
    **PrairieLearn: Find Uses of File** in the explorer's context menu (works
    for images too).
- Completions, code lenses, and quick fixes that create missing files.
- Editor-title buttons for switching between a question's `question.html`,
  `info.json`, and `server.py`. The current or missing source file remains
  visible but is disabled.

### Settings

Set these in `.vscode/settings.json`. They take precedence over the course's
[`.pl-navigator.jsonc`](packages/cli/README.md#configuration), which the CLI
also reads. User-level settings rank below that file.

| Setting | |
| --- | --- |
| `prairielearn-navigator.plVersion` | `latest` (default), a date (`YYYY-MM-DD`), or a commit sha |
| `prairielearn-navigator.schemaCacheDir` | Schema cache, relative to the workspace folder. Default: the extension's storage |
| `prairielearn-navigator.rules` | Rule id → `off` / `warning` / `error` |
| `prairielearn-navigator.excludes` | Glob patterns of files never to check, relative to the workspace folder. Adds to the course file's `excludes` rather than replacing them. |

Run **PrairieLearn: Reload Schemas and Config** to retry downloads after going
back online.

## CLI

The extension's diagnostics are also published as a CLI,
[`@sybelblue/prairielearn-navigator`](packages/cli/README.md), so a course
repo can fail CI on them:

```sh
npx -y @sybelblue/prairielearn-navigator check --format github
```

See [packages/cli/README.md](packages/cli/README.md) for options and a GitHub
Actions example.

The npm package also has a typed, headless
[`createQuestionFileResolver`](packages/cli/README.md#library-api) API for
applications that need normalized question-local, inherited-template, and
course-level file usage without invoking the CLI.

## Development

Common commands are in the [Makefile](Makefile). Run `make help` to list them:

```sh
make install     # npm ci
make test-all    # lint, CLI tests (Vitest), extension tests (VS Code)
make package     # build a .vsix
make check ARGS="path/to/course"   # run the CLI against a course
```

To try every feature, run the **Run Extension (Demo Course)** launch
configuration (F5 in the Run and Debug view). It opens
[demo/course](demo/course), a small course with deliberate problems, and its
[TOUR.md](demo/course/TOUR.md). This repo's own
[.vscode/settings.json](.vscode/settings.json) excludes `demo/` and the
broken test fixtures, so they don't fill the Problems panel while you work on
the extension itself.

### Adding a rule

Other rules live in [src/core/rules/registry.ts](src/core/rules/registry.ts). Each
rule id maps to an ordered list of `[plVersionRange, courseRelativeGlob, impl]`
entries, and for each file the first entry that matches both runs.
Version ranges compare dates, e.g. `">=2025-04-17"`. When PrairieLearn changes,
add a newer entry above the old one instead of editing it. Also add a new rule
id to [schemas/pl-navigator.schema.json](schemas/pl-navigator.schema.json); a
test checks the two agree.

Every JSON field and element attribute that names a file is one entry in
[src/core/references/specs.ts](src/core/references/specs.ts). Each entry gets
its existence rule, jump-to-file, and uses from that table, so adding a
reference is one entry there plus its rule id in the config schema. Tests
check every entry has a registered rule, a schema entry, and a fixture.

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
4. Opens your npmjs.com Staged Packages page so you can review and approve the
   version with 2FA. The script then waits for `quit` or `check published`;
   the latter verifies the version is public before continuing.
5. Publishes the extension with `vsce publish`, **only once the npm version is
   public**.

Use `make publish patch DRY_RUN=1` to run the checks and print the release
steps without changing anything.

If a step after the push fails, the tag and GitHub release already exist but
the extension isn't published. Fix the problem (for a failed workflow, rerun it
with `gh run rerun <id>`), then run `make publish-vscode` from the release
commit. It opens the staged npm version for approval if needed, then publishes
the extension after you confirm npm has made the version public. If you chose
`quit` at the npm prompt, use this command when you're ready to resume; it
reopens the Staged Packages page unless the version is already public.

One-time setup:

- `gh auth login`
- Sign in to npmjs.com with 2FA enabled, needed to approve staged publishes
- `npx vsce login sybelblue`, using a Marketplace personal access token
- On npmjs.com, the package's trusted publisher must be GitHub Actions,
  `SybelBlue/prairielearn-navigator`, workflow `publish-npm.yml`, environment
  `npm`, with stage-publish permission.
