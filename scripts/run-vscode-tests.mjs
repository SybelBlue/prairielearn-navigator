import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "plnv-vt-"),
);
const fixtures = path.join(temporaryRoot, "fx");
const runner = path.join(
  repository,
  "node_modules",
  "@vscode",
  "test-cli",
  "out",
  "bin.mjs",
);

let result;
try {
  fs.cpSync(path.join(repository, "src", "test-cli", "fixtures"), fixtures, {
    recursive: true,
  });
  // A previously interrupted direct test run may have left its generated
  // benchmark directory in the source fixture. Never carry it into a run.
  fs.rmSync(path.join(fixtures, "broken", "questions", "perfBulk"), {
    recursive: true,
    force: true,
  });
  result = spawnSync(process.execPath, [runner, ...process.argv.slice(2)], {
    cwd: repository,
    env: {
      ...process.env,
      PL_NAVIGATOR_VSCODE_TEST_FIXTURES: fixtures,
      // Keep this short: macOS limits Unix-domain socket paths to 103 bytes.
      PL_NAVIGATOR_VSCODE_TEST_USER_DATA: path.join(temporaryRoot, "ud"),
    },
    stdio: "inherit",
  });
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

if (result?.error) {
  throw result.error;
}
if (result?.signal) {
  console.error(`VS Code tests exited from signal ${result.signal}`);
}
process.exitCode = result?.status ?? 1;
