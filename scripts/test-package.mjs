import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webpack from "webpack";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), "prairielearn-navigator-package-"),
);

try {
  const npmEnvironment = {
    ...process.env,
    npm_config_cache: path.join(temporary, "npm-cache"),
  };
  const packed = execFileSync(
    "npm",
    ["pack", "--silent", "--pack-destination", temporary],
    {
      cwd: path.join(root, "packages", "cli"),
      encoding: "utf8",
      env: npmEnvironment,
    },
  ).trim();
  const tarball = path.join(temporary, packed.split("\n").at(-1));
  const consumer = path.join(temporary, "consumer");
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({
      type: "module",
    }),
  );
  const installed = path.join(
    consumer,
    "node_modules",
    "@sybelblue",
    "prairielearn-navigator",
  );
  fs.mkdirSync(installed, { recursive: true });
  execFileSync(
    "tar",
    ["-xzf", tarball, "-C", installed, "--strip-components", "1"],
    { stdio: "inherit" },
  );

  const source = [
    'import { createQuestionFileResolver } from "@sybelblue/prairielearn-navigator";',
    'if (typeof createQuestionFileResolver !== "function") throw new Error("missing export");',
    'console.log("library-ok");',
  ].join("\n");
  fs.writeFileSync(path.join(consumer, "consumer.mjs"), source);
  fs.writeFileSync(path.join(consumer, "consumer.ts"), source);
  fs.writeFileSync(
    path.join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        strict: true,
        noEmit: true,
      },
      include: ["consumer.ts"],
    }),
  );

  const library = fs.readFileSync(path.join(installed, "dist", "index.js"), "utf8");
  if (/from\s+["']vscode["']|require\(["']vscode["']\)/.test(library)) {
    throw new Error("packed library imports vscode");
  }
  fs.accessSync(
    path.join(installed, "dist", "core", "questionFileResolver.d.ts"),
  );

  const output = execFileSync(process.execPath, ["consumer.mjs"], {
    cwd: consumer,
    encoding: "utf8",
  }).trim();
  if (output !== "library-ok") {
    throw new Error(`unexpected import output: ${output}`);
  }
  execFileSync(
    path.join(root, "node_modules", ".bin", "tsc"),
    ["-p", path.join(consumer, "tsconfig.json")],
    { stdio: "inherit" },
  );

  await new Promise((resolve, reject) => {
    webpack(
      {
        context: consumer,
        entry: "./consumer.mjs",
        target: "node22",
        mode: "production",
        experiments: { outputModule: true },
        output: {
          path: path.join(consumer, "bundle"),
          filename: "consumer.mjs",
          module: true,
        },
      },
      (error, stats) => {
        if (error) return reject(error);
        if (stats?.hasErrors()) {
          return reject(new Error(stats.toString({ colors: false })));
        }
        resolve();
      },
    );
  });
  const bundled = execFileSync(
    process.execPath,
    [path.join("bundle", "consumer.mjs")],
    { cwd: consumer, encoding: "utf8" },
  ).trim();
  if (bundled !== "library-ok") {
    throw new Error(`unexpected bundle output: ${bundled}`);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
