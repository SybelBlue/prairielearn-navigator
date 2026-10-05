import typescriptEslint from "typescript-eslint";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}, {
    // The core and CLI run outside VS Code and must stay editor-agnostic.
    files: ["src/core/**/*.ts", "src/cli/**/*.ts", "src/test-cli/**/*.ts"],
    rules: {
        "no-restricted-imports": ["error", {
            paths: [{ name: "vscode", message: "src/core and src/cli must not depend on vscode." }],
        }],
    },
}];