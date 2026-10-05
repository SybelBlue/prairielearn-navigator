import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

/** Rebuilds dist/cli.js so CLI tests never run against a stale bundle. */
export default function setup(project: TestProject) {
  execSync("npx webpack --config-name cli", {
    cwd: project.config.root,
    stdio: "ignore",
  });
}
