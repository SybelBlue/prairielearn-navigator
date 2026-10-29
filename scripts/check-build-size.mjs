import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KiB = 1024;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmPackage = path.join(root, "packages", "cli");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const vsce = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vsce.cmd" : "vsce",
);

const budgets = {
  extensionAsset: 250 * KiB,
  extensionJavaScript: 350 * KiB,
  npmAsset: 200 * KiB,
  npmJavaScript: 350 * KiB,
  npmPacked: 200 * KiB,
  npmUnpacked: 500 * KiB,
  vsix: 250 * KiB,
};

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
}

function bytes(file) {
  return fs.statSync(file).size;
}

function format(size) {
  return `${(size / KiB).toFixed(1)} KiB`;
}

function enforce(label, actual, maximum) {
  console.log(`${label.padEnd(28)} ${format(actual)} / ${format(maximum)}`);
  if (actual > maximum) {
    throw new Error(`${label} exceeds its size budget`);
  }
}

const extensionStale = path.join(root, "dist", "stale.js");
const npmStale = path.join(npmPackage, "dist", "stale.js.map");
fs.mkdirSync(path.dirname(extensionStale), { recursive: true });
fs.mkdirSync(path.dirname(npmStale), { recursive: true });
fs.writeFileSync(extensionStale, "stale extension output");
fs.writeFileSync(npmStale, "stale npm output");

run(npmCommand, ["run", "package"], { stdio: "inherit" });
run(npmCommand, ["run", "build:npm"], { stdio: "inherit" });

for (const stale of [extensionStale, npmStale]) {
  if (fs.existsSync(stale)) {
    throw new Error(`build did not clean stale output: ${stale}`);
  }
}

const extensionAssets = ["extension.js", "vendors.js"].map((name) =>
  path.join(root, "dist", name),
);
const npmAssets = ["cli.js", "index.js", "shared.js"].map((name) =>
  path.join(npmPackage, "dist", name),
);

console.log("\nUncompressed JavaScript budgets");
for (const asset of extensionAssets) {
  enforce(
    `extension ${path.basename(asset)}`,
    bytes(asset),
    budgets.extensionAsset,
  );
}
enforce(
  "extension JavaScript total",
  extensionAssets.reduce((total, asset) => total + bytes(asset), 0),
  budgets.extensionJavaScript,
);
for (const asset of npmAssets) {
  enforce(`npm ${path.basename(asset)}`, bytes(asset), budgets.npmAsset);
}
enforce(
  "npm JavaScript total",
  npmAssets.reduce((total, asset) => total + bytes(asset), 0),
  budgets.npmJavaScript,
);

const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), "prairielearn-navigator-size-"),
);
try {
  const npmEnvironment = {
    ...process.env,
    npm_config_cache: path.join(temporary, "npm-cache"),
  };
  const packOutput = run(
    npmCommand,
    [
      "pack",
      "--silent",
      "--json",
      "--pack-destination",
      temporary,
    ],
    { cwd: npmPackage, env: npmEnvironment },
  );
  // npm includes prepack's webpack output before its JSON, even with
  // --silent. The package metadata is the final JSON array in stdout.
  const jsonStart = packOutput.lastIndexOf("\n[\n  {");
  const packed = JSON.parse(
    packOutput.slice(jsonStart === -1 ? 0 : jsonStart + 1),
  )[0];
  const packedFiles = packed.files.map(({ path: file }) => file).sort();
  const expectedPackedFiles = [
    "LICENSE",
    "README.md",
    "dist/cli.js",
    "dist/core/questionFileResolver.d.ts",
    "dist/index.js",
    "dist/shared.js",
    "package.json",
  ];
  if (JSON.stringify(packedFiles) !== JSON.stringify(expectedPackedFiles)) {
    throw new Error(
      `unexpected npm package contents: ${JSON.stringify(packedFiles)}`,
    );
  }

  const vsix = path.join(temporary, "prairielearn-navigator.vsix");
  run(
    vsce,
    ["package", "--no-dependencies", "--out", vsix],
    { stdio: "inherit" },
  );
  const vsixEntries = run("unzip", ["-Z1", vsix]).split("\n");
  const unwanted = vsixEntries.filter(
    (entry) =>
      /(?:^|\/)(?:todo\.md|tsconfig[^/]*\.json)$/.test(entry) ||
      entry.endsWith(".map") ||
      entry.includes("/packages/"),
  );
  if (unwanted.length > 0) {
    throw new Error(`unexpected VSIX files: ${unwanted.join(", ")}`);
  }

  console.log("\nPacked distribution budgets");
  enforce("npm tarball", packed.size, budgets.npmPacked);
  enforce("npm unpacked", packed.unpackedSize, budgets.npmUnpacked);
  enforce("VSIX", bytes(vsix), budgets.vsix);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
