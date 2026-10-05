#!/usr/bin/env bash
# Release the extension and the npm CLI under one shared version.
#
#   scripts/release.sh patch|minor|major   full release (see `make publish`)
#   scripts/release.sh --resume-vscode     finish a release whose npm workflow
#                                          succeeded: approve npm, then vsce
#
# Order: preflight -> tests -> bump + commit + tag + push -> GitHub release
# (triggers .github/workflows/publish-npm.yml, which stages the npm version)
# -> wait for it -> `npm stage approve` (2FA) -> wait until public -> vsce publish.
# The extension is never published unless the npm version is public.
#
# DRY_RUN=1 runs preflight and tests, then prints every command that would
# change something instead of running it.
set -euo pipefail

cd "$(dirname "$0")/.."

NPM_WORKFLOW=publish-npm.yml
NPM_PACKAGE=@sybelblue/prairielearn-navigator
DRY_RUN=${DRY_RUN:-}

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
run() {
  if [[ -n $DRY_RUN ]]; then
    printf '\033[33m[dry run]\033[0m %s\n' "$*"
  else
    "$@"
  fi
}

current_version() { node -p "require('./package.json').version"; }

next_version() {
  node -e '
    const [bump, version] = process.argv.slice(1);
    const [major, minor, patch] = version.split(".").map(Number);
    const next = { major: [major + 1, 0, 0], minor: [major, minor + 1, 0], patch: [major, minor, patch + 1] }[bump];
    console.log(next.join("."));
  ' "$1" "$2"
}

require_vsce_login() {
  local publisher
  publisher=$(node -p "require('./package.json').publisher")
  npx vsce ls-publishers | grep -qx "$publisher" \
    || die "vsce is not logged in as '$publisher'. Run: npx vsce login $publisher"
}

npm_run_for() {
  # Prints "<databaseId> <status> <conclusion> <url>" for the newest npm workflow run on a commit.
  gh run list --workflow "$NPM_WORKFLOW" --commit "$1" --limit 1 \
    --json databaseId,status,conclusion,url \
    --jq '.[0] | select(.) | "\(.databaseId) \(.status) \(.conclusion) \(.url)"'
}

npm_is_public() {
  [[ $(npm view "$NPM_PACKAGE@$1" version --prefer-online 2>/dev/null) == "$1" ]]
}

staged_id_for() {
  # The stage id of $NPM_PACKAGE@$1, or nothing. Accepts a few JSON shapes.
  npm stage list "$NPM_PACKAGE" --json 2>/dev/null | node -e '
    let input = "";
    process.stdin.on("data", (d) => (input += d)).on("end", () => {
      let data;
      try { data = JSON.parse(input); } catch { return; }
      const entries = Array.isArray(data) ? data : data.stages ?? data.objects ?? Object.values(data);
      const version = process.argv[1];
      const entry = entries.find((e) => (e?.version ?? e?.package?.version ?? e?.manifest?.version) === version);
      const id = entry?.id ?? entry?.stageId ?? entry?.stage_id;
      if (id) console.log(id);
    });
  ' "$1"
}

approve_npm() {
  local version=$1 stage_id=
  if [[ -z $DRY_RUN ]] && npm_is_public "$version"; then
    echo "  $NPM_PACKAGE@$version is already public."
    return
  fi

  step "Approving staged $NPM_PACKAGE@$version (needs your 2FA)"
  if [[ -n $DRY_RUN ]]; then
    run npm stage approve "<stage id for $version>"
    return
  fi
  for _ in $(seq 1 12); do
    stage_id=$(staged_id_for "$version")
    [[ -n $stage_id ]] && break
    sleep 5
  done
  if [[ -z $stage_id ]]; then
    npm stage list "$NPM_PACKAGE" || true
    read -rp "Stage id for $NPM_PACKAGE@$version (empty to abort): " stage_id
    [[ -n $stage_id ]] || die "No stage approved, so the extension was NOT published. Finish later with: make publish-vscode"
  fi
  npm stage approve "$stage_id" \
    || die "Approving stage $stage_id failed, so the extension was NOT published.
  Retry:  npm stage approve $stage_id
  Then:   make publish-vscode"

  step "Waiting for $NPM_PACKAGE@$version to be public"
  for _ in $(seq 1 60); do
    npm_is_public "$version" && return
    sleep 10
  done
  die "Approved, but $NPM_PACKAGE@$version is still not visible after 10 minutes, so the extension was NOT published.
  Once it shows up: make publish-vscode"
}

publish_vscode() {
  step "Publishing v$1 to the VS Code Marketplace"
  # No version argument: vsce publishes package.json's version without bumping or tagging.
  run npx vsce publish
}

finish() {
  local version=$1 repo_url
  repo_url=$(gh repo view --json url --jq .url)
  step "Released v$version"
  echo "  npm:         https://www.npmjs.com/package/$NPM_PACKAGE/v/$version"
  echo "  Marketplace: https://marketplace.visualstudio.com/items?itemName=$(node -p "const p = require('./package.json'); p.publisher + '.' + p.name")"
  echo "  GitHub:      $repo_url/releases/tag/v$version"
}

# ── Resume: extension only ──

if [[ ${1:-} == --resume-vscode ]]; then
  version=$(current_version)
  tag="v$version"
  sha=$(git rev-parse HEAD)

  step "Checking that $tag is ready for the Marketplace"
  git tag --points-at HEAD | grep -qx "$tag" \
    || die "HEAD is not tagged $tag. Check out the release commit first."
  read -r _ status conclusion url <<<"$(npm_run_for "$sha")" || true
  [[ ${status:-} == completed && ${conclusion:-} == success ]] \
    || die "The $NPM_WORKFLOW run for $tag has not succeeded (${status:-no run}/${conclusion:-}). ${url:-}"
  npm whoami >/dev/null 2>&1 || die "npm is not logged in. Run: npm login"
  require_vsce_login

  approve_npm "$version"
  publish_vscode "$version"
  [[ -n $DRY_RUN ]] || finish "$version"
  exit 0
fi

# ── Full release ──

bump=${1:-}
[[ $bump =~ ^(major|minor|patch)$ ]] || die "usage: $0 patch|minor|major | --resume-vscode"

current=$(current_version)
version=$(next_version "$bump" "$current")
tag="v$version"
[[ -n $DRY_RUN ]] && step "DRY RUN: nothing will be changed"

step "Preflight for $tag ($bump bump from $current)"
[[ $(git rev-parse --abbrev-ref HEAD) == main ]] || die "Not on main."
[[ -z $(git status --porcelain) ]] || die "Working tree is not clean. Commit or stash first."
git fetch --quiet origin main
[[ $(git rev-parse HEAD) == $(git rev-parse origin/main) ]] \
  || die "main is not in sync with origin/main. Pull or push first."
[[ $(node -p "require('./packages/cli/package.json').version") == "$current" ]] \
  || die "packages/cli/package.json version does not match package.json ($current)."
grep -q '^## \[Unreleased\]' CHANGELOG.md || die "CHANGELOG.md has no '## [Unreleased]' heading."
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "Tag $tag already exists locally."
git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null && die "Tag $tag already exists on origin."
gh auth status >/dev/null 2>&1 || die "gh is not logged in. Run: gh auth login"
npm whoami >/dev/null 2>&1 || die "npm is not logged in (needed to approve the staged publish). Run: npm login"
require_vsce_login

step "Running lint and tests"
npm run lint
npm run test:cli
npm test

step "Bumping to $version"
run npm version "$version" --no-git-tag-version
(cd packages/cli && run npm version "$version" --no-git-tag-version)
# shellcheck disable=SC2016 # ${version} is a JS template literal, not shell
run node -e '
  const fs = require("fs");
  const [version, date] = process.argv.slice(1);
  const text = fs.readFileSync("CHANGELOG.md", "utf8");
  fs.writeFileSync("CHANGELOG.md", text.replace("## [Unreleased]", `## [Unreleased]\n\n## [${version}] - ${date}`));
' "$version" "$(date +%Y-%m-%d)"

step "Committing, tagging, and pushing $tag"
run git add package.json package-lock.json packages/cli/package.json CHANGELOG.md
run git commit -m "$tag"
run git tag -a "$tag" -m "$tag"
run git push --atomic origin main "$tag"

step "Creating GitHub release $tag (stages $NPM_PACKAGE via Actions)"
run gh release create "$tag" --verify-tag --generate-notes --title "$tag" \
  || die "Creating the GitHub release failed, so nothing was published. $tag is already pushed.
  Retry:            gh release create $tag --verify-tag --generate-notes --title $tag
  When npm is out:  make publish-vscode"

step "Waiting for the $NPM_WORKFLOW run"
if [[ -n $DRY_RUN ]]; then
  run gh run watch "<run for $tag>" --exit-status
else
  sha=$(git rev-parse HEAD)
  run_id=
  for _ in $(seq 1 24); do
    read -r run_id _ _ url <<<"$(npm_run_for "$sha")" || true
    [[ -n $run_id ]] && break
    sleep 5
  done
  [[ -n $run_id ]] || die "No $NPM_WORKFLOW run appeared for $tag after 2 minutes. The extension was NOT published.
Check https://github.com/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/actions, then run: make publish-vscode"
  echo "  $url"
  if ! gh run watch "$run_id" --exit-status --interval 10; then
    die "Staging the npm publish failed, so the extension was NOT published. $tag is already pushed and released.
  Inspect: gh run view $run_id --log-failed
  Fix the problem, then: gh run rerun $run_id
  When it succeeds:      make publish-vscode"
  fi
fi

approve_npm "$version"
publish_vscode "$version"
[[ -n $DRY_RUN ]] || finish "$version"
