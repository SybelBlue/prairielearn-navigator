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
  assert.match(stdout, /6 errors, 3 warnings in 3 files \(8 files, 6 questions checked\)/);
});

test("lists every checked file, with each assessment's questions under it", () => {
  const { stdout } = runCli("check", "broken");
  const listing = stdout.split("\n\n")[0].split("\n");
  assert.deepEqual(listing, [
    "broken/courseInstances/Fa26/assessments/hw1/infoAssessment.json",
    ...[
      "good",
      "topic/nested",
      "inlineText",
      "noHtml",
      "noInfo",
      "doesNotExist",
    ].map((id) => `  broken/questions/${id}/info.json`),
    "broken/infoCourse.json",
    ...["badSchema", "deps", "good", "inlineText", "noHtml", "topic/nested"].map(
      (id) => `broken/questions/${id}/info.json`
    ),
  ]);
});

test("missing clientFilesCourse dependencies are errors", () => {
  const { stdout } = runCli("check", "broken/questions/deps");
  assert.match(
    stdout,
    /broken\/questions\/deps\/info\.json:8:48 error: file not found: clientFilesCourse\/missing\.css \[client-files-course-exist\]/
  );
  assert.match(stdout, /"\.\.\/escape\.js" must be a path inside clientFilesCourse\//);
  assert.doesNotMatch(stdout, /not found: clientFilesCourse\/exists\.css/);
});

test("validates against the pinned PrairieLearn schema", () => {
  const { stdout } = runCli("check", "broken/questions/badSchema");
  assert.match(
    stdout,
    /6:20 error: \/singleVariant must be boolean \(PL schema 151aabd\) \[schema\]/
  );
  assert.match(stdout, /7:19 warning: unknown property "notAProperty"/);
});

test("--config can turn rules off or change their severity", () => {
  const { code, stdout } = runCli(
    "check",
    "--config",
    "configs/relaxed.jsonc",
    "broken/questions"
  );
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /\[schema\]/);
  assert.match(stdout, /warning: file not found: clientFilesCourse\/missing\.css/);
});

test("config problems are reported on the config file", () => {
  const { code, stdout } = runCli(
    "check",
    "--config",
    "configs/invalid.jsonc",
    "clean"
  );
  assert.equal(code, 1);
  assert.match(stdout, /configs\/invalid\.jsonc:3:16 error: invalid plVersion "v1\.2\.3"/);
  assert.match(stdout, /configs\/invalid\.jsonc:4:3 warning: unknown config key "colour"/);
  assert.match(stdout, /invalid\.jsonc:5:14 warning: unknown rule "nope"/);
});

test("invalid --pl-version exits 1", () => {
  const { code, stderr } = runCli("check", "--pl-version", "1.2.3", "clean");
  assert.equal(code, 1);
  assert.match(stderr, /invalid plVersion "1\.2\.3"/);
});

test("--format github groups the checked files", () => {
  const { stdout } = runCli("check", "--format", "github", "clean");
  assert.match(
    stdout,
    /^::group::Checked files\nclean\/courseInstances\/Fa26\/assessments\/hw1\/infoAssessment\.json\n {2}clean\/questions\/good\/info\.json\nclean\/infoCourse\.json\nclean\/questions\/good\/info\.json\n::endgroup::$/m
  );
});

test("--format github emits workflow annotations", () => {
  const { code, stdout } = runCli("check", "--format", "github", "broken");
  assert.equal(code, 1);
  const lines = stdout.split("\n").filter((l) => /^::(error|warning) /.test(l));
  assert.equal(lines.length, 9);
  assert.match(
    lines[0],
    /^::warning file=broken\/courseInstances\/Fa26\/assessments\/hw1\/infoAssessment\.json,line=10,col=18,endLine=10,endColumn=22,title=prairielearn-navigator::Duplicate question ID.* \[duplicate-question-id\]$/
  );
  assert.equal(lines.filter((l) => l.startsWith("::error ")).length, 6);
});

test("clean course exits 0", () => {
  const { code, stdout } = runCli("check", "clean");
  assert.equal(code, 0);
  assert.match(stdout, /No errors found \(3 files, 1 question checked\)/);
});

test("assessment outside a course warns but does not fail", () => {
  const { code, stdout } = runCli("check", "noCourse");
  assert.equal(code, 0);
  assert.match(stdout, /warning: not inside a course/);
});

test("no matching files exits 1", () => {
  const { code, stderr } = runCli("check", "broken/clientFilesCourse");
  assert.equal(code, 1);
  assert.match(stderr, /No PrairieLearn course JSON files found/);
});

test("glob matching directories searches inside them", () => {
  const { code, stdout } = runCli("check", "{broken,clean}/courseInstances/*");
  assert.equal(code, 1);
  assert.match(stdout, /3 errors, 2 warnings in 1 file \(2 files, 7 questions checked\)/);
});

test("glob matching files keeps only course JSON files", () => {
  const { code, stdout } = runCli("check", "clean/**");
  assert.equal(code, 0);
  assert.match(stdout, /No errors found \(3 files, 1 question checked\)/);
});

test("glob with no matches exits 1", () => {
  const { code, stderr } = runCli("check", "nope/**/*.json");
  assert.equal(code, 1);
  assert.match(stderr, /No PrairieLearn course JSON files found/);
});

test("invalid usage exits 1", () => {
  assert.equal(runCli("bogus").code, 1);
  assert.equal(runCli("check", "--format", "xml").code, 1);
  assert.equal(runCli("check", "--help").code, 0);
});
