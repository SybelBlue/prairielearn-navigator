import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { test } from "vitest";

const cli = path.resolve(__dirname, "../../packages/cli/dist/cli.js");
const fixtures = path.join(__dirname, "fixtures");

function runCli(...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: fixtures,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("broken course exits 1 with code frames", () => {
  const { code, stdout } = runCli("check", "broken");
  assert.equal(code, 1);
  const assessment = path.join(
    "broken",
    "courseInstances/Fa26/assessments/hw1/infoAssessment.json"
  );
  assert.match(
    stdout,
    new RegExp(
      `${assessment.replace(/[/.]/g, "\\$&")}:13:18 error: incomplete question: missing required html file`
    )
  );
  assert.match(stdout, /13 \|\s+\{ "id": "noHtml", "points": 1 \},/);
  assert.match(stdout, /\s+\^{6} incomplete question/);
  assert.match(stdout, /3 errors, 2 warnings in 1 file \(1 file checked\)/);
});

test("--format github emits workflow annotations", () => {
  const { code, stdout } = runCli("check", "--format", "github", "broken");
  assert.equal(code, 1);
  const lines = stdout.split("\n").filter((l) => l.startsWith("::"));
  assert.equal(lines.length, 5);
  assert.match(
    lines[0],
    /^::warning file=broken\/courseInstances\/Fa26\/assessments\/hw1\/infoAssessment\.json,line=10,col=18,endLine=10,endColumn=22,title=prairielearn-navigator::Duplicate question ID/
  );
  assert.equal(lines.filter((l) => l.startsWith("::error ")).length, 3);
});

test("clean course exits 0", () => {
  const { code, stdout } = runCli("check", "clean");
  assert.equal(code, 0);
  assert.match(stdout, /No errors found \(1 file checked\)/);
});

test("assessment outside a course warns but does not fail", () => {
  const { code, stdout } = runCli("check", "noCourse");
  assert.equal(code, 0);
  assert.match(stdout, /warning: not inside a course/);
});

test("no matching files exits 1", () => {
  const { code, stderr } = runCli("check", "broken/questions");
  assert.equal(code, 1);
  assert.match(stderr, /No infoAssessment\.json files found/);
});

test("glob matching directories searches inside them", () => {
  const { code, stdout } = runCli("check", "{broken,clean}/courseInstances/*");
  assert.equal(code, 1);
  assert.match(stdout, /3 errors, 2 warnings in 1 file \(2 files checked\)/);
});

test("glob matching files keeps only infoAssessment.json", () => {
  const { code, stdout } = runCli("check", "clean/**");
  assert.equal(code, 0);
  assert.match(stdout, /No errors found \(1 file checked\)/);
});

test("glob with no matches exits 1", () => {
  const { code, stderr } = runCli("check", "nope/**/*.json");
  assert.equal(code, 1);
  assert.match(stderr, /No infoAssessment\.json files found/);
});

test("invalid usage exits 1", () => {
  assert.equal(runCli("bogus").code, 1);
  assert.equal(runCli("check", "--format", "xml").code, 1);
  assert.equal(runCli("check", "--help").code, 0);
});
