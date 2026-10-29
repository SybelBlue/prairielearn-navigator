import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

/** Rebuilds the npm entries so CLI tests never run against a stale bundle. */
export default function setup(project: TestProject) {
  execSync("npm run build:npm", {
    cwd: project.config.root,
    stdio: "ignore",
  });
}
