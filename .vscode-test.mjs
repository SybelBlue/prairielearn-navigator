import { defineConfig } from '@vscode/test-cli';
import path from 'node:path';

const fixtures = process.env.PL_NAVIGATOR_VSCODE_TEST_FIXTURES ?? 'src/test-cli/fixtures';
const userDataDir = process.env.PL_NAVIGATOR_VSCODE_TEST_USER_DATA;

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// A course pinned to vendored schemas, so the tests run offline
	workspaceFolder: path.join(fixtures, 'broken'),
	...(userDataDir ? { launchArgs: [`--user-data-dir=${userDataDir}`] } : {}),
});
