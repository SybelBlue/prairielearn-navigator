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

  const distFiles = fs
    .readdirSync(path.join(installed, "dist"), { recursive: true })
    .filter((entry) =>
      fs.statSync(path.join(installed, "dist", entry)).isFile(),
    )
    .map((entry) => String(entry).split(path.sep).join("/"))
    .sort();
  const expectedDistFiles = [
    "cli.js",
    "core/questionFileResolver.d.ts",
    "index.js",
    "shared.js",
  ];
  if (JSON.stringify(distFiles) !== JSON.stringify(expectedDistFiles)) {
    throw new Error(
      `unexpected packed dist files: ${JSON.stringify(distFiles)}`,
    );
  }

  const cli = path.join(installed, "dist", "cli.js");
  if (!fs.readFileSync(cli, "utf8").startsWith("#!/usr/bin/env node\n")) {
    throw new Error("packed CLI is missing its executable shebang");
  }
  // npm creates an executable bin link on install. The tar entry itself is
  // not executable, so set that bit here to exercise the shebang as well as
  // checking the package's bin mapping below.
  fs.chmodSync(cli, 0o755);
  const cliHelp = execFileSync(cli, ["--help"], {
    encoding: "utf8",
  });
  if (!cliHelp.startsWith("Usage: prairielearn-navigator")) {
    throw new Error(`unexpected CLI help output: ${cliHelp}`);
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(installed, "package.json"), "utf8"),
  );
  if (manifest.bin?.["prairielearn-navigator"] !== "dist/cli.js") {
    throw new Error("packed CLI bin mapping is incorrect");
  }

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

  const library = ["index.js", "shared.js"]
    .map((file) => fs.readFileSync(path.join(installed, "dist", file), "utf8"))
    .join("\n");
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
