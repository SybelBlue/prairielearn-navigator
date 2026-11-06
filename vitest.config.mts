import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync("packages/cli/package.json", "utf8"));

export default defineConfig({
  // Matches the DefinePlugin in webpack.config.js.
  define: { __CLI_VERSION__: JSON.stringify(version) },
  test: {
    // src/test holds the Mocha suite run inside VS Code by @vscode/test-cli.
    include: ["src/test-cli/**/*.test.ts"],
  },
});
