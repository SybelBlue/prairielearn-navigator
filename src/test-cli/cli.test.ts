import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
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
  assert.match(stdout, /25 errors, 4 warnings, 6 infos in 10 files \(22 files, 6 questions checked\)/);
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
    "broken/elements/my-el/info.json",
    "broken/infoCourse.json",
    ...[
      "allElements/info.json",
      "allElements/question.html",
      "badSchema/info.json",
      "badSchema/question.html",
      "commented/info.json",
      "commented/question.html",
      "deps/info.json",
      "deps/question.html",
      "figures/info.json",
      "figures/question.html",
      "good/info.json",
      "good/question.html",
      "inlineText/info.json",
      "jsonRefs/info.json",
      "jsonRefs/question.html",
      "noHtml/info.json",
      "noInfo/question.html",
      "topic/nested/info.json",
      "topic/nested/question.html",
    ].map((f) => `broken/questions/${f}`),
    // Not a file the CLI checks, but where a course-wide rule reports
    "broken/questions/onlyServer/server.py",
  ]);
});

test("missing clientFilesCourse dependencies are errors", () => {
  const { stdout } = runCli("check", "broken/questions/deps");
  assert.match(
    stdout,
    /broken\/questions\/deps\/info\.json:7:48 error: file not found: clientFilesCourse\/missing\.css \[client-files-course-exist\]/
  );
  assert.match(stdout, /"\.\.\/escape\.js" must be a path inside clientFilesCourse\//);
  assert.doesNotMatch(stdout, /not found: clientFilesCourse\/exists\.css/);
});

test("missing pl-figure files are errors", () => {
  const { stdout } = runCli("check", "broken/questions/figures");
  assert.match(
    stdout,
    /question\.html:3:23 error: file not found: questions\/figures\/clientFilesQuestion\/missing\.png \[pl-figure-file-exist\]/
  );
  assert.match(stdout, /5:64 error: file not found: clientFilesCourse\/gone\.png/);
  assert.match(stdout, /invalid pl-figure directory "serverFilesCourse"/);
  assert.match(stdout, /4 errors, 1 info in 1 file \(2 files, 0 questions checked\)/);
});

test("every element and JSON field that names a file is checked", () => {
  const { stdout } = runCli("check", "broken/questions/allElements", "broken/questions/jsonRefs", "broken/elements");
  for (const rule of [
    "pl-file-download", "pl-code", "pl-file-editor", "pl-graph", "pl-excalidraw", "pl-template",
  ]) {
    assert.match(stdout, new RegExp(`error: .* \\[${rule}-file-exist\\]`), rule);
  }
  assert.match(stdout, /warning: file not found: questions\/jsonRefs\/client\.js \[client-files-question-exist\]/);
  assert.match(stdout, /error: file not found: questions\/jsonRefs\/clientFilesQuestion\/missing\.css/);
  assert.match(stdout, /error: file or directory not found: serverFilesCourse\/graders \[server-files-course-exist\]/);
  assert.match(stdout, /error: file not found: elements\/my-el\/missing\.js \[element-files-exist\]/);
  assert.match(stdout, /11 errors, 1 warning, 2 infos in 3 files/);
});

test("comments and trailing commas in course JSON are errors, as in PrairieLearn", () => {
  const { stdout } = runCli("check", "broken/questions/commented");
  assert.match(stdout, /info\.json:2:3 error: comments are not allowed/);
  assert.match(stdout, /info\.json:6:15 error: trailing commas are not allowed/);
  assert.match(stdout, /2 errors, 1 info in 1 file/);
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
    "broken/questions/deps",
    "broken/questions/figures",
    "broken/questions/badSchema"
  );
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /\[schema\]/);
  assert.match(stdout, /warning: file not found: clientFilesCourse\/missing\.css/);
});

test("unused questions are infos by default", () => {
  const { code, stdout } = runCli("check", "broken/questions/commented");
  assert.equal(code, 1); // from its syntax errors
  assert.match(
    stdout,
    /info\.json:4:12 info: question "commented" is not used by any assessment \[unused-question\]/
  );
  assert.doesNotMatch(runCli("check", "clean").stdout, /unused-question/);
});

test("--unused-questions sets their severity", () => {
  const ignored = runCli("check", "--unused-questions", "ignored", "broken/questions/commented");
  assert.doesNotMatch(ignored.stdout, /unused-question/);
  assert.match(ignored.stdout, /2 errors in 1 file/);

  const errors = runCli("check", "--unused-questions", "error", "broken/questions/commented");
  assert.match(errors.stdout, /4:12 error: question "commented" is not used/);
  assert.match(errors.stdout, /3 errors in 1 file/);

  const github = runCli("check", "--format", "github", "broken/questions/commented");
  assert.match(github.stdout, /^::notice file=.*commented\/info\.json,line=4,.*\[unused-question\]$/m);

  const bogus = runCli("check", "--unused-questions", "bogus", "clean");
  assert.equal(bogus.code, 1);
  assert.match(bogus.stderr, /unusedQuestions must be "ignored", "info", "warning", or "error"/);
});

test("unusedQuestions in the config file sets their severity", () => {
  const { stdout } = runCli(
    "check",
    "--config",
    "configs/unused.jsonc",
    "broken/questions/commented",
    "names"
  );
  assert.match(stdout, /4:12 warning: question "commented" is not used/);
  assert.match(stdout, /8:15 info: tag "unused" is not used/);
  assert.match(stdout, /12:36 error: assessment set "Quiz" is not used/);
});

test("unused tags and assessment sets are warnings by default", () => {
  const { code, stdout } = runCli("check", "names");
  assert.equal(code, 0);
  assert.match(stdout, /infoCourse\.json:8:15 warning: tag "unused" is not used by any question \[unused-tag\]/);
  assert.match(
    stdout,
    /infoCourse\.json:12:36 warning: assessment set "Quiz" is not used by any assessment \[unused-assessment-set\]/
  );
  assert.doesNotMatch(stdout, /tag "used" is not|set "Homework" is not/);
  assert.match(stdout, /2 warnings in 1 file/);
});

test("--unused-tags and --unused-assessment-sets set their severity", () => {
  const { code, stdout } = runCli(
    "check", "--unused-tags", "error", "--unused-assessment-sets", "ignored", "names"
  );
  assert.equal(code, 1);
  assert.match(stdout, /8:15 error: tag "unused" is not used/);
  assert.doesNotMatch(stdout, /unused-assessment-set/);

  const bogus = runCli("check", "--unused-assessment-sets", "off", "names");
  assert.equal(bogus.code, 1);
  assert.match(bogus.stderr, /unusedAssessmentSets must be "ignored", "info", "warning", or "error"/);
});

test("question directories without info.json are errors that PrairieLearn fails to load", () => {
  const { code, stdout } = runCli("check", "broken/questions");
  assert.equal(code, 1);
  // On question.html, with its code frame
  assert.match(
    stdout,
    /broken\/questions\/noInfo\/question\.html:1:1 error: directory "noInfo" in questions\/ has files but no info\.json: PrairieLearn will fail to load it from disk \(Missing JSON file: questions\/noInfo\/info\.json\) \[question-info-missing\]\n +\|\n1 \|/
  );
  // Else on the first file, without showing it
  assert.match(
    stdout,
    /broken\/questions\/onlyServer\/server\.py:1:1 error: directory "onlyServer" .*\[question-info-missing\]\n\n/
  );
  // topic/ holds a question below it, and hidden directories are skipped
  assert.doesNotMatch(stdout, /directory "(topic|\.hidden)"/);
});

test("question directories without info.json are reported only within the paths checked", () => {
  const { stdout } = runCli("check", "broken/questions/commented");
  assert.doesNotMatch(stdout, /question-info-missing/);
  const globbed = runCli("check", "broken/questions/only*");
  assert.match(globbed.stdout, /onlyServer\/server\.py:1:1 error/);
  assert.doesNotMatch(globbed.stdout, /noInfo/);
  // From above the course, too
  assert.match(runCli("check", ".").stdout, /onlyServer\/server\.py:1:1 error/);
});

test("--missing-question-info sets their severity", () => {
  const warning = runCli("check", "--missing-question-info", "warning", "broken/questions/onlyServer");
  assert.equal(warning.code, 0);
  assert.match(warning.stdout, /server\.py:1:1 warning: directory "onlyServer"/);
  assert.match(warning.stdout, /1 warning in 1 file/);

  const ignored = runCli("check", "--missing-question-info", "ignored", "broken/questions");
  assert.doesNotMatch(ignored.stdout, /question-info-missing/);

  const bogus = runCli("check", "--missing-question-info", "off", "broken");
  assert.equal(bogus.code, 1);
  assert.match(bogus.stderr, /missingQuestionInfo must be "ignored", "info", "warning", or "error"/);
});

test("config problems are reported on the config file", () => {
  // The file's invalid plVersion would fall back to "latest" and download
  // schemas; pin the version so the test stays offline
  const { code, stdout } = runCli(
    "check",
    "--config",
    "configs/invalid.jsonc",
    "--pl-version",
    "151aabd1167dbdc170c50f71295a74de9f31db05",
    "clean"
  );
  assert.equal(code, 1);
  assert.deepEqual(
    fs.readdirSync(path.join(fixtures, "schema-cache")).filter((d) => d.startsWith("master-")),
    [],
    "a test downloaded schemas instead of using the pinned snapshot"
  );
  assert.match(stdout, /configs\/invalid\.jsonc:3:16 error: invalid plVersion "v1\.2\.3"/);
  assert.match(stdout, /configs\/invalid\.jsonc:4:3 warning: unknown config key "colour"/);
  assert.match(stdout, /invalid\.jsonc:5:14 warning: unknown rule "nope"/);
});

test("--exclude and config excludes skip files entirely", () => {
  const { code, stdout } = runCli(
    "check",
    "--exclude", "broken/questions/**",
    "--exclude", "broken/elements/**",
    "--exclude", "broken/courseInstances/**",
    "broken"
  );
  assert.equal(code, 0);
  assert.match(stdout, /No errors found \(1 file, 0 questions checked\)/);
  assert.doesNotMatch(stdout, /questions\//);
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
    /^::group::Checked files\nclean\/courseInstances\/Fa26\/assessments\/hw1\/infoAssessment\.json\n {2}clean\/questions\/good\/info\.json\nclean\/infoCourse\.json\nclean\/questions\/good\/info\.json\nclean\/questions\/good\/question\.html\n::endgroup::$/m
  );
});

test("--format github emits workflow annotations", () => {
  const { code, stdout } = runCli("check", "--format", "github", "broken");
  assert.equal(code, 1);
  const lines = stdout.split("\n").filter((l) => /^::(error|warning) /.test(l));
  assert.equal(lines.length, 29);
  assert.match(
    lines[0],
    /^::warning file=broken\/courseInstances\/Fa26\/assessments\/hw1\/infoAssessment\.json,line=10,col=18,endLine=10,endColumn=22,title=prairielearn-navigator::Duplicate question ID.* \[duplicate-question-id\]$/
  );
  assert.equal(lines.filter((l) => l.startsWith("::error ")).length, 25);
  assert.ok(
    lines.includes(
      "::error file=broken/questions/onlyServer/server.py,line=1,col=1,endLine=1,endColumn=1,title=prairielearn-navigator::" +
        'directory "onlyServer" in questions/ has files but no info.json: PrairieLearn will fail to load it from disk ' +
        "(Missing JSON file: questions/onlyServer/info.json) [question-info-missing]"
    )
  );
});

test("clean course exits 0", () => {
  const { code, stdout } = runCli("check", "clean");
  assert.equal(code, 0);
  assert.match(stdout, /No errors found \(4 files, 1 question checked\)/);
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
  assert.match(stdout, /No errors found \(4 files, 1 question checked\)/);
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
