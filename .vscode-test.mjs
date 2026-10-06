import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// A course pinned to vendored schemas, so the tests run offline
	workspaceFolder: 'src/test-cli/fixtures/broken',
});
