import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // src/test holds the Mocha suite run inside VS Code by @vscode/test-cli.
    include: ["src/test-cli/**/*.test.ts"],
    globalSetup: ["src/test-cli/globalSetup.mts"],
  },
});
