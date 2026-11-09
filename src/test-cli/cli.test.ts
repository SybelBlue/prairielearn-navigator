import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "vitest";
import { createFiles } from "../cli/edits";
import { run } from "../cli/runner";

const fixtures = path.join(__dirname, "fixtures");

async function runCli(...args: string[]) {
  return runCliAt(fixtures, ...args);
}

async function runCliAt(cwd: string, ...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    cwd,
    stdout: (message = "") => stdout.push(message),
    stderr: (message = "") => stderr.push(message),
  });
  const output = (lines: string[]) => lines.length > 0 ? lines.join("\n") + "\n" : "";
  return { code, stdout: output(stdout), stderr: output(stderr) };
}

test("noun commands show usage and reject unknown subcommands", async () => {
  for (const noun of ["qid", "tag", "assessment-set", "assessment"]) {
    const help = await runCli(noun, "--help");
    assert.equal(help.code, 0);
    assert.match(help.stdout, new RegExp(`^Usage: prairielearn-navigator ${noun} <subcommand>`));
    assert.match(help.stdout, /^  list\b/m);
    if (noun === "assessment") {
      assert.doesNotMatch(help.stdout, /^  uses\b/m);
    } else {
      assert.match(help.stdout, /^  uses\b/m);
    }

    const missing = await runCli(noun);
    assert.equal(missing.code, 1);
    assert.equal(missing.stdout, help.stdout);

    const unknown = await runCli(noun, "bogus");
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, new RegExp(`^Unknown ${noun} subcommand: bogus`));
  }
});

test("the verb-first forms are not commands", async () => {
  for (const verb of ["rename", "list", "uses"]) {
    const { code, stderr } = await runCli(verb, "qid");
    assert.equal(code, 1);
    assert.match(stderr, new RegExp(`^Unknown command: ${verb}`));
  }
});

test("deprecated rename commands warn and behave like their replacements", async () => {
  const cases = [
    { old: "rename-qids", noun: "qid", args: ["--course", "clean", "old", "new"] },
    { old: "rename-tags", noun: "tag", args: ["--course", "names", "used", "homework"] },
    {
      old: "rename-assessment-sets",
      noun: "assessment-set",
      args: ["--course", "names", "Homework", "Problem Set"],
    },
  ];
  for (const { old, noun, args } of cases) {
    const deprecated = await runCli(old, ...args);
    const current = await runCli(noun, "rename", ...args);
    assert.equal(deprecated.code, 0);
    assert.equal(deprecated.stdout, current.stdout);
    assert.equal(
      deprecated.stderr,
      `Warning: "${old}" is deprecated and will be removed in 1.4.0. Use "${noun} rename" instead.\n`
    );
    assert.equal(current.stderr, "");
  }
});

test("qid rename previews and writes multiple semantic QID mappings", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-navigator-rename-cli-"));
  const course = path.join(root, "course");
  fs.cpSync(path.join(fixtures, "broken"), course, { recursive: true });
  const assessment = path.join(
    course,
    "courseInstances/Fa26/assessments/hw1/infoAssessment.json"
  );
  const template = path.join(course, "questions/jsonRefs/info.json");
  const beforeAssessment = fs.readFileSync(assessment, "utf-8");
  const beforeTemplate = fs.readFileSync(template, "utf-8");
  try {
    const preview = await runCliAt(
      course,
      "qid", "rename",
      "good",
      "better",
      "topic/nested",
      "unit/nested"
    );
    assert.equal(preview.code, 0);
    assert.match(preview.stdout, /Would update 4 references in 2 files/);
    assert.match(preview.stdout, /"good" -> "better"/);
    assert.match(preview.stdout, /"topic\/nested" -> "unit\/nested"/);
    assert.equal(fs.readFileSync(assessment, "utf-8"), beforeAssessment);
    assert.equal(fs.readFileSync(template, "utf-8"), beforeTemplate);

    const written = await runCliAt(
      course,
      "qid", "rename",
      "--write",
      "good",
      "better",
      "topic/nested",
      "unit/nested"
    );
    assert.equal(written.code, 0);
    assert.match(written.stdout, /Updated 4 references in 2 files/);
    const assessmentValue = JSON.parse(fs.readFileSync(assessment, "utf-8"));
    assert.deepEqual(
      assessmentValue.zones[0].questions.map((question: { id: string }) => question.id),
      [
        "better",
        "unit/nested",
        "inlineText",
        "noHtml",
        "noInfo",
        "doesNotExist",
        "better",
      ]
    );
    const templateValue = JSON.parse(fs.readFileSync(template, "utf-8"));
    assert.equal(templateValue.template, "better");
    assert.equal(templateValue.title, "Q");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("qid rename validates mappings and treats no matches as success", async () => {
  const odd = await runCli("qid", "rename", "--course", "clean", "old");
  assert.equal(odd.code, 1);
  assert.match(odd.stderr, /old\/new pairs/);

  const escaping = await runCli(
    "qid", "rename",
    "--course",
    "clean",
    "../old",
    "new"
  );
  assert.equal(escaping.code, 1);
  assert.match(escaping.stderr, /must not contain/);

  const conflict = await runCli(
    "qid", "rename",
    "--course",
    "clean",
    "old",
    "one",
    "old",
    "two"
  );
  assert.equal(conflict.code, 1);
  assert.match(conflict.stderr, /Conflicting QID renames/);

  const none = await runCli(
    "qid", "rename",
    "--course",
    "clean",
    "unused",
    "new"
  );
  assert.equal(none.code, 0);
  assert.match(none.stdout, /No semantic QID references matched/);
});

test("tag rename previews and writes a tag rename", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-navigator-rename-tags-"));
  const course = path.join(root, "course");
  fs.cpSync(path.join(fixtures, "names"), course, { recursive: true });
  const infoCourse = path.join(course, "infoCourse.json");
  const question = path.join(course, "questions/q/info.json");
  const before = fs.readFileSync(question, "utf-8");
  try {
    const preview = await runCliAt(course, "tag", "rename", "used", "homework");
    assert.equal(preview.code, 0, preview.stderr);
    assert.match(preview.stdout, /"\\"used\\"" -> "\\"homework\\""/);
    assert.match(preview.stdout, /Would make 2 edits in 2 files/);
    assert.equal(fs.readFileSync(question, "utf-8"), before);

    const written = await runCliAt(course, "tag", "rename", "--write", "used", "homework");
    assert.equal(written.code, 0, written.stderr);
    assert.match(written.stdout, /Made 2 edits in 2 files/);
    assert.deepEqual(JSON.parse(fs.readFileSync(question, "utf-8")).tags, ["homework"]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(infoCourse, "utf-8")).tags.map((t: { name: string }) => t.name),
      ["homework", "unused"]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("tag rename validates its arguments and the tags", async () => {
  const one = await runCli("tag", "rename", "--course", "names", "used");
  assert.equal(one.code, 1);
  assert.match(one.stderr, /Exactly one old tag and one new tag/);

  const undefinedTag = await runCli("tag", "rename", "--course", "names", "nope", "new");
  assert.equal(undefinedTag.code, 1);
  assert.match(undefinedTag.stderr, /Tag "nope" is not defined in infoCourse.json/);

  const taken = await runCli("tag", "rename", "--course", "names", "used", "unused");
  assert.equal(taken.code, 1);
  assert.match(taken.stderr, /Tag "unused" is already defined/);
});

test("assessment-set rename previews and writes an assessment set rename", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-navigator-rename-sets-"));
  const course = path.join(root, "course");
  fs.cpSync(path.join(fixtures, "names"), course, { recursive: true });
  const infoCourse = path.join(course, "infoCourse.json");
  const assessment = path.join(course, "courseInstances/Fa26/assessments/hw1/infoAssessment.json");
  const before = fs.readFileSync(assessment, "utf-8");
  try {
    const preview = await runCliAt(course, "assessment-set", "rename", "Homework", "Problem Set");
    assert.equal(preview.code, 0, preview.stderr);
    assert.match(preview.stdout, /"\\"Homework\\"" -> "\\"Problem Set\\""/);
    assert.match(preview.stdout, /Would make 2 edits in 2 files/);
    assert.equal(fs.readFileSync(assessment, "utf-8"), before);

    const written = await runCliAt(course, "assessment-set", "rename", "--write", "Homework", "Problem Set");
    assert.equal(written.code, 0, written.stderr);
    assert.match(written.stdout, /Made 2 edits in 2 files/);
    const json = JSON.parse(fs.readFileSync(assessment, "utf-8"));
    assert.deepEqual([json.type, json.set], ["Homework", "Problem Set"]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(infoCourse, "utf-8")).assessmentSets.map((s: { name: string }) => s.name),
      ["Problem Set", "Quiz"]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("assessment-set rename validates its arguments and the sets", async () => {
  const help = await runCli("assessment-set", "rename", "--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: prairielearn-navigator assessment-set rename/);

  const one = await runCli("assessment-set", "rename", "--course", "names", "Homework");
  assert.equal(one.code, 1);
  assert.match(one.stderr, /Exactly one old assessment set and one new assessment set/);

  const undefinedSet = await runCli("assessment-set", "rename", "--course", "names", "Exam", "Final");
  assert.equal(undefinedSet.code, 1);
  assert.match(undefinedSet.stderr, /Assessment set "Exam" is not defined in infoCourse.json/);

  const taken = await runCli("assessment-set", "rename", "--course", "names", "Homework", "Quiz");
  assert.equal(taken.code, 1);
  assert.match(taken.stderr, /Assessment set "Quiz" is already defined/);
});

test("broken course exits 1 with code frames", async () => {
  const { code, stdout } = await runCli("check", "broken");
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

test("lists every checked file, with each assessment's questions under it", async () => {
  const { stdout } = await runCli("check", "broken");
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

test("missing clientFilesCourse dependencies are errors", async () => {
  const { stdout } = await runCli("check", "broken/questions/deps");
  assert.match(
    stdout,
    /broken\/questions\/deps\/info\.json:7:48 error: file not found: clientFilesCourse\/missing\.css \[client-files-course-exist\]/
  );
  assert.match(stdout, /"\.\.\/escape\.js" must be a path inside clientFilesCourse\//);
  assert.doesNotMatch(stdout, /not found: clientFilesCourse\/exists\.css/);
});

test("missing pl-figure files are errors", async () => {
  const { stdout } = await runCli("check", "broken/questions/figures");
  assert.match(
    stdout,
    /question\.html:3:23 error: file not found: questions\/figures\/clientFilesQuestion\/missing\.png \[pl-figure-file-exist\]/
  );
  assert.match(stdout, /5:64 error: file not found: clientFilesCourse\/gone\.png/);
  assert.match(stdout, /invalid pl-figure directory "serverFilesCourse"/);
  assert.match(stdout, /4 errors, 1 info in 1 file \(2 files, 0 questions checked\)/);
});

test("every element and JSON field that names a file is checked", async () => {
  const { stdout } = await runCli("check", "broken/questions/allElements", "broken/questions/jsonRefs", "broken/elements");
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

test("comments and trailing commas in course JSON are errors, as in PrairieLearn", async () => {
  const { stdout } = await runCli("check", "broken/questions/commented");
  assert.match(stdout, /info\.json:2:3 error: comments are not allowed/);
  assert.match(stdout, /info\.json:6:15 error: trailing commas are not allowed/);
  assert.match(stdout, /2 errors, 1 info in 1 file/);
});

test("validates against the pinned PrairieLearn schema", async () => {
  const { stdout } = await runCli("check", "broken/questions/badSchema");
  assert.match(
    stdout,
    /6:20 error: \/singleVariant must be boolean \(PL schema 151aabd\) \[schema\]/
  );
  assert.match(stdout, /7:19 warning: unknown property "notAProperty"/);
});

test("--config can turn rules off or change their severity", async () => {
  const { code, stdout } = await runCli(
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

test("unused questions are infos by default", async () => {
  const { code, stdout } = await runCli("check", "broken/questions/commented");
  assert.equal(code, 1); // from its syntax errors
  assert.match(
    stdout,
    /info\.json:4:12 info: question "commented" is not used by any assessment \[unused-question\]/
  );
  assert.doesNotMatch((await runCli("check", "clean")).stdout, /unused-question/);
});

test("--unused-questions sets their severity", async () => {
  const ignored = await runCli("check", "--unused-questions", "ignored", "broken/questions/commented");
  assert.doesNotMatch(ignored.stdout, /unused-question/);
  assert.match(ignored.stdout, /2 errors in 1 file/);

  const errors = await runCli("check", "--unused-questions", "error", "broken/questions/commented");
  assert.match(errors.stdout, /4:12 error: question "commented" is not used/);
  assert.match(errors.stdout, /3 errors in 1 file/);

  const github = await runCli("check", "--format", "github", "broken/questions/commented");
  assert.match(github.stdout, /^::notice file=.*commented\/info\.json,line=4,.*\[unused-question\]$/m);

  const bogus = await runCli("check", "--unused-questions", "bogus", "clean");
  assert.equal(bogus.code, 1);
  assert.match(bogus.stderr, /unusedQuestions must be "ignored", "info", "warning", or "error"/);
});

test("unusedQuestions in the config file sets their severity", async () => {
  const { stdout } = await runCli(
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

test("unused tags and assessment sets are warnings by default", async () => {
  const { code, stdout } = await runCli("check", "names");
  assert.equal(code, 0);
  assert.match(stdout, /infoCourse\.json:8:15 warning: tag "unused" is not used by any question \[unused-tag\]/);
  assert.match(
    stdout,
    /infoCourse\.json:12:36 warning: assessment set "Quiz" is not used by any assessment \[unused-assessment-set\]/
  );
  assert.doesNotMatch(stdout, /tag "used" is not|set "Homework" is not/);
  assert.match(stdout, /2 warnings in 1 file/);
});

test("--unused-tags and --unused-assessment-sets set their severity", async () => {
  const { code, stdout } = await runCli(
    "check", "--unused-tags", "error", "--unused-assessment-sets", "ignored", "names"
  );
  assert.equal(code, 1);
  assert.match(stdout, /8:15 error: tag "unused" is not used/);
  assert.doesNotMatch(stdout, /unused-assessment-set/);

  const bogus = await runCli("check", "--unused-assessment-sets", "off", "names");
  assert.equal(bogus.code, 1);
  assert.match(bogus.stderr, /unusedAssessmentSets must be "ignored", "info", "warning", or "error"/);
});

test("question directories without info.json are errors that PrairieLearn fails to load", async () => {
  const { code, stdout } = await runCli("check", "broken/questions");
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

test("question directories without info.json are reported only within the paths checked", async () => {
  const { stdout } = await runCli("check", "broken/questions/commented");
  assert.doesNotMatch(stdout, /question-info-missing/);
  const globbed = await runCli("check", "broken/questions/only*");
  assert.match(globbed.stdout, /onlyServer\/server\.py:1:1 error/);
  assert.doesNotMatch(globbed.stdout, /noInfo/);
  // From above the course, too
  assert.match((await runCli("check", ".")).stdout, /onlyServer\/server\.py:1:1 error/);
});

test("--missing-question-info sets their severity", async () => {
  const warning = await runCli("check", "--missing-question-info", "warning", "broken/questions/onlyServer");
  assert.equal(warning.code, 0);
  assert.match(warning.stdout, /server\.py:1:1 warning: directory "onlyServer"/);
  assert.match(warning.stdout, /1 warning in 1 file/);

  const ignored = await runCli("check", "--missing-question-info", "ignored", "broken/questions");
  assert.doesNotMatch(ignored.stdout, /question-info-missing/);

  const bogus = await runCli("check", "--missing-question-info", "off", "broken");
  assert.equal(bogus.code, 1);
  assert.match(bogus.stderr, /missingQuestionInfo must be "ignored", "info", "warning", or "error"/);
});

test("config problems are reported on the config file", async () => {
  // The file's invalid plVersion would fall back to "latest" and download
  // schemas; pin the version so the test stays offline
  const { code, stdout } = await runCli(
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

test("--exclude and config excludes skip files entirely", async () => {
  const { code, stdout } = await runCli(
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

test("invalid --pl-version exits 1", async () => {
  const { code, stderr } = await runCli("check", "--pl-version", "1.2.3", "clean");
  assert.equal(code, 1);
  assert.match(stderr, /invalid plVersion "1\.2\.3"/);
});

test("--format github groups the checked files", async () => {
  const { stdout } = await runCli("check", "--format", "github", "clean");
  assert.match(
    stdout,
    /^::group::Checked files\nclean\/courseInstances\/Fa26\/assessments\/hw1\/infoAssessment\.json\n {2}clean\/questions\/good\/info\.json\nclean\/infoCourse\.json\nclean\/questions\/good\/info\.json\nclean\/questions\/good\/question\.html\n::endgroup::$/m
  );
});

test("--format github emits workflow annotations", async () => {
  const { code, stdout } = await runCli("check", "--format", "github", "broken");
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

test("clean course exits 0", async () => {
  const { code, stdout } = await runCli("check", "clean");
  assert.equal(code, 0);
  assert.match(stdout, /No errors found \(4 files, 1 question checked\)/);
});

test("assessment outside a course warns but does not fail", async () => {
  const { code, stdout } = await runCli("check", "noCourse");
  assert.equal(code, 0);
  assert.match(stdout, /warning: not inside a course/);
});

test("no matching files exits 1", async () => {
  const { code, stderr } = await runCli("check", "broken/clientFilesCourse");
  assert.equal(code, 1);
  assert.match(stderr, /No PrairieLearn course JSON files found/);
});

test("glob matching directories searches inside them", async () => {
  const { code, stdout } = await runCli("check", "{broken,clean}/courseInstances/*");
  assert.equal(code, 1);
  assert.match(stdout, /3 errors, 2 warnings in 1 file \(2 files, 7 questions checked\)/);
});

test("glob matching files keeps only course JSON files", async () => {
  const { code, stdout } = await runCli("check", "clean/**");
  assert.equal(code, 0);
  assert.match(stdout, /No errors found \(4 files, 1 question checked\)/);
});

test("glob with no matches exits 1", async () => {
  const { code, stderr } = await runCli("check", "nope/**/*.json");
  assert.equal(code, 1);
  assert.match(stderr, /No PrairieLearn course JSON files found/);
});

test("list prints one sorted item per line", async () => {
  const qids = await runCli("qid", "list", "--course", "broken");
  assert.equal(qids.code, 0);
  assert.equal(qids.stderr, "");
  assert.deepEqual(qids.stdout.trimEnd().split("\n"), [
    "allElements",
    "badSchema",
    "commented",
    "deps",
    "figures",
    "good",
    "inlineText",
    "jsonRefs",
    "noHtml",
    "topic/nested",
  ]);

  const expected = [
    ["tag", "unused\nused\n"],
    ["assessment-set", "Homework\nQuiz\n"],
    ["assessment", "Fa26/hw1\n"],
  ];
  for (const [noun, stdout] of expected) {
    const listed = await runCli(noun, "list", "--course", "names");
    assert.equal(listed.code, 0);
    assert.equal(listed.stdout, stdout);
  }
});

test("list --json prints each subcommand's structured rows", async () => {
  const cases: [string, unknown][] = [
    ["qid", [{ qid: "q", tags: ["used"] }]],
    [
      "tag",
      [
        { name: "unused", defined: true, used: false },
        { name: "used", defined: true, used: true },
      ],
    ],
    [
      "assessment-set",
      [
        { name: "Homework", defined: true, used: true },
        { name: "Quiz", defined: true, used: false },
      ],
    ],
    ["assessment", [{ instance: "Fa26", assessment: "hw1", set: "Homework" }]],
  ];
  for (const [noun, expected] of cases) {
    const { code, stdout } = await runCli(noun, "list", "--json", "--course=names");
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout), expected);
  }
});

test("list omits undefined names unless --include-undefined is given", async () => {
  const defaults = await runCli("assessment-set", "list", "--course", "clean");
  assert.equal(defaults.code, 0);
  assert.equal(defaults.stdout, "");

  const included = await runCli(
    "assessment-set", "list", "--include-undefined", "--json", "--course", "clean"
  );
  assert.equal(included.code, 0);
  assert.deepEqual(JSON.parse(included.stdout), [{ name: "Homework", defined: false, used: true }]);
});

test("list's default tags and sets are all accepted by rename", async () => {
  for (const noun of ["tag", "assessment-set"]) {
    const { stdout } = await runCli(noun, "list", "--course", "names");
    for (const name of stdout.trimEnd().split("\n")) {
      const renamed = await runCli(noun, "rename", "--course", "names", name, `${name}2`);
      assert.equal(renamed.code, 0, renamed.stderr);
    }
  }
});

test("--include-undefined only applies to tags and assessment sets", async () => {
  for (const noun of ["qid", "assessment"]) {
    const { code, stderr } = await runCli(noun, "list", "--include-undefined", "--course", "names");
    assert.equal(code, 1);
    assert.match(stderr, /^Unknown option: --include-undefined/);
    assert.doesNotMatch((await runCli(noun, "list", "--help")).stdout, /--include-undefined/);
  }
  for (const noun of ["tag", "assessment-set"]) {
    assert.match((await runCli(noun, "list", "--help")).stdout, /--include-undefined/);
  }
});

test("list prints nothing for empty results", async () => {
  const text = await runCli("tag", "list", "--course", "clean");
  assert.equal(text.code, 0);
  assert.equal(text.stdout, "");

  const json = await runCli("tag", "list", "--json", "--course", "clean");
  assert.equal(json.code, 0);
  assert.deepEqual(JSON.parse(json.stdout), []);
});

test("list reports usage and argument errors", async () => {
  const help = await runCli("qid", "list", "--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: prairielearn-navigator qid list \[options\]/);

  const option = await runCli("qid", "list", "--bogus");
  assert.equal(option.code, 1);
  assert.match(option.stderr, /^Unknown option: --bogus/);

  const positional = await runCli("qid", "list", "extra");
  assert.equal(positional.code, 1);
  assert.match(positional.stderr, /^Unexpected argument: extra/);

  const noValue = await runCli("qid", "list", "--course");
  assert.equal(noValue.code, 1);
  assert.match(noValue.stderr, /^Missing value for --course/);

  const noCourse = await runCli("qid", "list", "--course", "noCourse");
  assert.equal(noCourse.code, 1);
  assert.match(noCourse.stderr, /^No PrairieLearn course found for /);
});

test("locate prints a name's definition in infoCourse.json", async () => {
  const tag = await runCli("tag", "locate", "--course", "names", "used");
  assert.equal(tag.code, 0);
  assert.equal(tag.stdout, `${path.join("names", "infoCourse.json")}:7:15\n`);

  const set = await runCli("assessment-set", "locate", "--json", "--course", "names", "Quiz");
  assert.equal(set.code, 0);
  assert.deepEqual(JSON.parse(set.stdout), {
    path: path.join("names", "infoCourse.json"),
    lineSpan: [12, 12],
    colSpan: [36, 42],
  });
});

test("locate prints the file of a question or assessment, with no span", async () => {
  const cases = [
    ["qid", "q", path.join("names", "questions", "q", "info.json")],
    [
      "assessment",
      "Fa26/hw1",
      path.join("names", "courseInstances", "Fa26", "assessments", "hw1", "infoAssessment.json"),
    ],
  ];
  for (const [noun, target, file] of cases) {
    const text = await runCli(noun, "locate", "--course", "names", target);
    assert.equal(text.code, 0);
    assert.equal(text.stdout, `${file}\n`);

    const json = await runCli(noun, "locate", "--json", "--course", "names", target);
    assert.equal(json.code, 0);
    assert.deepEqual(JSON.parse(json.stdout), { path: file });
  }
});

test("locate finds everything list prints", async () => {
  for (const noun of ["qid", "tag", "assessment-set", "assessment"]) {
    const { stdout } = await runCli(noun, "list", "--course", "names");
    for (const target of stdout.trimEnd().split("\n")) {
      const located = await runCli(noun, "locate", "--course", "names", target);
      assert.equal(located.code, 0, located.stderr);
    }
  }
});

test("locate fails for anything not defined", async () => {
  const cases = [
    ["qid", "nope", /^Question "nope" is not defined/],
    ["tag", "nope", /^Tag "nope" is not defined in infoCourse\.json/],
    ["assessment-set", "nope", /^Assessment set "nope" is not defined in infoCourse\.json/],
    ["assessment", "Fa26/nope", /^Assessment "Fa26\/nope" is not defined/],
  ] as const;
  for (const [noun, target, message] of cases) {
    for (const flags of [[], ["--json"]]) {
      const { code, stdout, stderr } = await runCli(
        noun, "locate", ...flags, "--course", "names", target
      );
      assert.equal(code, 1);
      assert.equal(stdout, "");
      assert.match(stderr, message);
    }
  }

  // Used by hw1 and a PrairieLearn default, but infoCourse.json does not define it.
  const undefinedSet = await runCli("assessment-set", "locate", "--course", "clean", "Homework");
  assert.equal(undefinedSet.code, 1);
  assert.match(undefinedSet.stderr, /^Assessment set "Homework" is not defined/);
});

test("locate reports usage and argument errors", async () => {
  const help = await runCli("tag", "locate", "--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: prairielearn-navigator tag locate \[options\] <tag>/);

  const none = await runCli("tag", "locate", "--course", "names");
  assert.equal(none.code, 1);
  assert.match(none.stderr, /^Exactly one tag is required/);

  const two = await runCli("assessment-set", "locate", "--course", "names", "Homework", "Quiz");
  assert.equal(two.code, 1);
  assert.match(two.stderr, /^Exactly one assessment set is required/);

  const option = await runCli("qid", "locate", "--bogus", "q");
  assert.equal(option.code, 1);
  assert.match(option.stderr, /^Unknown option: --bogus/);

  const noCourse = await runCli("qid", "locate", "--course", "noCourse", "q");
  assert.equal(noCourse.code, 1);
  assert.match(noCourse.stderr, /^No PrairieLearn course found for /);
});

/** A temporary course containing every semantic reference kind used by `uses`. */
async function withUsesCourse(body: (root: string) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-navigator-uses-cli-"));
  const course = path.join(root, "course");
  const write = (relative: string, contents: string) => {
    const file = path.join(course, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };
  write(
    "infoCourse.json",
    '{ "tags": [{ "name": "used", "color": "blue1" }, { "name": "unused", "color": "gray1" }], "assessmentSets": [{ "name": "Homework" }, { "name": "Quiz" }] }\n'
  );
  write(
    "courseInstances/Fa26/assessments/hw1/infoAssessment.json",
    '{ "set": "Homework", "zones": [{ "questions": [{ "id": "q", "alternatives": [{ "id": "q" }, { "id": "missing" }] }] }] }\n'
  );
  write("questions/q/info.json", '{ "title": "Q", "tags": ["used", "used"] }\n');
  write("questions/template/info.json", '{ "title": "Template", "template": "q" }\n');
  write("questions/unused/info.json", '{ "title": "Unused" }\n');
  try {
    await body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("uses prints every semantic reference, excluding definitions", async () => {
  await withUsesCourse(async (root) => {
    const assessment = path.join(
      "course", "courseInstances", "Fa26", "assessments", "hw1", "infoAssessment.json"
    );
    const question = path.join("course", "questions", "q", "info.json");
    const template = path.join("course", "questions", "template", "info.json");

    const qid = await runCliAt(root, "qid", "uses", "--course", "course", "q");
    assert.equal(qid.code, 0, qid.stderr);
    assert.equal(qid.stderr, "");
    assert.equal(
      qid.stdout,
      `${assessment}:1:57\n${assessment}:1:87\n${template}:1:37\n`
    );

    const tag = await runCliAt(root, "tag", "uses", "--course=course", "used");
    assert.equal(tag.code, 0, tag.stderr);
    assert.equal(tag.stdout, `${question}:1:26\n${question}:1:34\n`);

    const set = await runCliAt(root, "assessment-set", "uses", "--course", "course", "Homework");
    assert.equal(set.code, 0, set.stderr);
    assert.equal(set.stdout, `${assessment}:1:10\n`);
  });
});

test("uses --json prints location spans", async () => {
  await withUsesCourse(async (root) => {
    const assessment = path.join(
      "course", "courseInstances", "Fa26", "assessments", "hw1", "infoAssessment.json"
    );
    const question = path.join("course", "questions", "q", "info.json");
    const template = path.join("course", "questions", "template", "info.json");
    const qid = await runCliAt(
      root, "qid", "uses", "--json", "--course", "course/questions/q", "q"
    );
    assert.equal(qid.code, 0, qid.stderr);
    assert.deepEqual(JSON.parse(qid.stdout), [
      { path: assessment, lineSpan: [1, 1], colSpan: [57, 58] },
      { path: assessment, lineSpan: [1, 1], colSpan: [87, 88] },
      { path: template, lineSpan: [1, 1], colSpan: [37, 38] },
    ]);

    const tag = await runCliAt(
      root, "tag", "uses", "--json", "--course", "course", "used"
    );
    assert.equal(tag.code, 0, tag.stderr);
    assert.deepEqual(JSON.parse(tag.stdout), [
      { path: question, lineSpan: [1, 1], colSpan: [26, 32] },
      { path: question, lineSpan: [1, 1], colSpan: [34, 40] },
    ]);

    const set = await runCliAt(
      root, "assessment-set", "uses", "--json", "--course", "course", "Homework"
    );
    assert.equal(set.code, 0, set.stderr);
    assert.deepEqual(JSON.parse(set.stdout), [
      { path: assessment, lineSpan: [1, 1], colSpan: [10, 20] },
    ]);
  });
});

test("qid uses finds missing questions and succeeds for no matches", async () => {
  await withUsesCourse(async (root) => {
    const assessment = path.join(
      "course", "courseInstances", "Fa26", "assessments", "hw1", "infoAssessment.json"
    );
    const missing = await runCliAt(root, "qid", "uses", "--course", "course", "missing");
    assert.equal(missing.code, 0, missing.stderr);
    assert.equal(missing.stdout, `${assessment}:1:102\n`);

    const text = await runCliAt(root, "qid", "uses", "--course", "course", "unused");
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout, "");

    const json = await runCliAt(
      root, "qid", "uses", "--json", "--course", "course", "unused"
    );
    assert.equal(json.code, 0, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout), []);
  });
});

test("tag and assessment-set uses require definitions and allow unused definitions", async () => {
  await withUsesCourse(async (root) => {
    for (const [noun, unused] of [["tag", "unused"], ["assessment-set", "Quiz"]]) {
      const result = await runCliAt(root, noun, "uses", "--course", "course", unused);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, "");
    }

    for (const [noun, message] of [
      ["tag", /^Tag "undefined" is not defined in infoCourse\.json/],
      ["assessment-set", /^Assessment set "undefined" is not defined in infoCourse\.json/],
    ] as const) {
      const result = await runCliAt(root, noun, "uses", "--course", "course", "undefined");
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, message);
    }
  });
});

test("uses reports help and argument errors", async () => {
  const help = await runCli("qid", "uses", "--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: prairielearn-navigator qid uses \[options\] <qid>/);

  const none = await runCli("qid", "uses", "--course", "names");
  assert.equal(none.code, 1);
  assert.match(none.stderr, /^Exactly one qid is required/);

  const two = await runCli("tag", "uses", "--course", "names", "used", "unused");
  assert.equal(two.code, 1);
  assert.match(two.stderr, /^Exactly one tag is required/);

  const option = await runCli("qid", "uses", "--bogus", "q");
  assert.equal(option.code, 1);
  assert.match(option.stderr, /^Unknown option: --bogus/);

  const noValue = await runCli("qid", "uses", "--course");
  assert.equal(noValue.code, 1);
  assert.match(noValue.stderr, /^Missing value for --course/);

  const noCourse = await runCli("qid", "uses", "--course", "noCourse", "q");
  assert.equal(noCourse.code, 1);
  assert.match(noCourse.stderr, /^No PrairieLearn course found for /);

  const invalid = await runCli("qid", "uses", "--course", "names", "../q");
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /^QID "\.\.\/q" must not contain/);

  const assessment = await runCli("assessment", "uses", "Fa26/hw1");
  assert.equal(assessment.code, 1);
  assert.match(assessment.stderr, /^Unknown assessment subcommand: uses/);
});

/** A copy of the `names` fixture with suppressions, removed when `body` finishes. */
async function withAssessmentCourse(body: (course: string) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-navigator-rename-assessment-"));
  const course = path.join(root, "course");
  fs.cpSync(path.join(fixtures, "names"), course, { recursive: true });
  fs.writeFileSync(path.join(course, ".pl-navigator.jsonc"), JSON.stringify({
    ignoredDiagnostics: [
      {
        file: "courseInstances/Fa26/assessments/hw1/infoAssessment.json",
        rule: "duplicate-question-id",
        identifier: "q",
      },
      { file: "questions/q/info.json", rule: "unused-question", identifier: "q" },
    ],
  }, null, 2));
  try {
    await body(course);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const hw1 = "courseInstances/Fa26/assessments/hw1";

test("assessment rename previews and writes a move and its suppressions", async () => {
  await withAssessmentCourse(async (course) => {
    const config = path.join(course, ".pl-navigator.jsonc");
    const before = fs.readFileSync(config, "utf-8");

    const preview = await runCliAt(course, "assessment", "rename", "Fa26/hw1", "Fa26/unit1/hw2");
    assert.equal(preview.code, 0, preview.stderr);
    assert.match(preview.stdout, /^courseInstances\/Fa26\/assessments\/hw1 -> courseInstances\/Fa26\/assessments\/unit1\/hw2\n/);
    assert.match(preview.stdout, /\.pl-navigator\.jsonc:\d+:\d+ /);
    assert.match(preview.stdout, /Would rename 1 assessment and 1 edit in 1 file\. Rerun with --write/);
    assert.ok(fs.existsSync(path.join(course, hw1)));
    assert.equal(fs.readFileSync(config, "utf-8"), before);

    const written = await runCliAt(
      course, "assessment", "rename", "--write", "Fa26/hw1", "Fa26/unit1/hw2"
    );
    assert.equal(written.code, 0, written.stderr);
    assert.match(written.stdout, /Renamed 1 assessment and 1 edit in 1 file\./);
    assert.ok(!fs.existsSync(path.join(course, hw1)));
    assert.deepEqual(
      JSON.parse(fs.readFileSync(config, "utf-8")).ignoredDiagnostics.map(
        (entry: { file: string }) => entry.file
      ),
      ["courseInstances/Fa26/assessments/unit1/hw2/infoAssessment.json", "questions/q/info.json"]
    );

    const listed = await runCliAt(course, "assessment", "list");
    assert.equal(listed.stdout, "Fa26/unit1/hw2\n");
    const located = await runCliAt(course, "assessment", "locate", "Fa26/unit1/hw2");
    assert.equal(located.code, 0, located.stderr);
  });
});

test("assessment rename removes directories it leaves empty", async () => {
  await withAssessmentCourse(async (course) => {
    const assessments = path.join(course, "courseInstances/Fa26/assessments");
    const rename = (...args: string[]) => runCliAt(course, "assessment", "rename", ...args);

    await rename("--write", "Fa26/hw1", "Fa26/a/b/hw1");

    // Staying under a directory keeps it, and only what is empty goes
    fs.mkdirSync(path.join(assessments, "a/other"));
    const kept = await rename("--write", "Fa26/a/b/hw1", "Fa26/a/hw1");
    assert.doesNotMatch(kept.stdout, /Remove empty directory .*\/a\n/);
    assert.match(kept.stdout, /Remove empty directory courseInstances\/Fa26\/assessments\/a\/b\n/);
    assert.ok(!fs.existsSync(path.join(assessments, "a/b")));
    assert.ok(fs.existsSync(path.join(assessments, "a/other")));

    fs.rmdirSync(path.join(assessments, "a/other"));
    const preview = await rename("Fa26/a/hw1", "Fa26/hw1");
    assert.match(preview.stdout, /Remove empty directory courseInstances\/Fa26\/assessments\/a\n/);
    assert.ok(fs.existsSync(path.join(assessments, "a")));

    await rename("--write", "Fa26/a/hw1", "Fa26/hw1");
    assert.deepEqual(fs.readdirSync(assessments), ["hw1"]);
  });
});

test("assessment rename never removes a directory its target is in", async () => {
  await withAssessmentCourse(async (course) => {
    const assessments = path.join(course, "courseInstances/Fa26/assessments");
    await runCliAt(course, "assessment", "rename", "--write", "Fa26/hw1", "Fa26/a/hw1");

    const { code, stdout } = await runCliAt(
      course, "assessment", "rename", "--write", "Fa26/a/hw1", "Fa26/a/b/hw1"
    );
    assert.equal(code, 0);
    assert.doesNotMatch(stdout, /Remove empty directory/);
    assert.ok(fs.existsSync(path.join(assessments, "a/b/hw1/infoAssessment.json")));
  });
});

test("assessment rename without suppressions only moves", async () => {
  const { code, stdout } = await runCli(
    "assessment", "rename", "--course", "names", "Fa26/hw1", "Fa26/hw2"
  );
  assert.equal(code, 0);
  assert.match(stdout, /Would rename 1 assessment\. Rerun with --write/);
});

test("assessment rename moves back if a write fails", async () => {
  await withAssessmentCourse(async (course) => {
    const config = path.join(course, ".pl-navigator.jsonc");
    fs.chmodSync(config, 0o444);
    try {
      const { code } = await runCliAt(
        course, "assessment", "rename", "--write", "Fa26/hw1", "Fa26/unit1/hw2"
      );
      assert.equal(code, 1);
      assert.ok(fs.existsSync(path.join(course, hw1)));
      assert.deepEqual(fs.readdirSync(path.join(course, "courseInstances/Fa26/assessments")), ["hw1"]);
    } finally {
      fs.chmodSync(config, 0o644);
    }
  });
});

test("assessment rename validates its arguments and the move", async () => {
  await withAssessmentCourse(async (course) => {
    fs.mkdirSync(path.join(course, "courseInstances/Fa26/assessments/taken"));

    const cases: [string[], RegExp][] = [
      [["Fa26/hw1"], /^Exactly one old assessment and one new assessment are required/],
      [["Fa26/nope", "Fa26/hw2"], /^Assessment "Fa26\/nope" is not defined/],
      [["Fa26/hw1", "Fa26/hw1"], /cannot be renamed to itself/],
      [["Fa26/hw1", "Sp27/hw1"], /must stay in course instance "Fa26"/],
      [["Fa26/hw1", "Fa26/taken"], /^Assessment "Fa26\/taken" already exists/],
      [["Fa26/hw1", "Fa26/hw1/sub"], /must not be inside "Fa26\/hw1"/],
      [["Fa26/hw1", "Fa26/../hw2"], /must not contain empty, "\.", or "\.\." path segments/],
      [["Fa26/hw1", "/tmp/hw2"], /must be a relative path/],
    ];
    for (const [args, message] of cases) {
      const { code, stderr } = await runCliAt(course, "assessment", "rename", "--write", ...args);
      assert.equal(code, 1);
      assert.match(stderr, message);
    }
    assert.ok(fs.existsSync(path.join(course, hw1)));
  });

  const help = await runCli("assessment", "rename", "--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: prairielearn-navigator assessment rename \[options\]/);
});

test("--version and -v print the package version", async () => {
  const { version } = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../packages/cli/package.json"), "utf8")
  );
  for (const flag of ["--version", "-v"]) {
    const result = await runCli(flag);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, `${version}\n`);
    assert.equal(result.stderr, "");
  }
});

test("top-level usage and invalid commands return the expected status", async () => {
  const help = await runCli("--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: prairielearn-navigator <command>/);

  const missing = await runCli();
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, help.stdout);

  const unknown = await runCli("bogus");
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /^Unknown command: bogus/);
  assert.equal((await runCli("check", "--format", "xml")).code, 1);
  assert.equal((await runCli("check", "--help")).code, 0);
});

test("add previews, then writes files and edits for every noun", async () => {
  await withAssessmentCourse(async (course) => {
    const infoCourse = path.join(course, "infoCourse.json");
    const before = fs.readFileSync(infoCourse, "utf-8");
    const cases: [string[], RegExp, string?][] = [
      [["qid", "add", "unit1/new"], /Create questions\/unit1\/new\/info\.json/, "questions/unit1/new/question.html"],
      [["assessment", "add", "Fa26/hw9"], /Create courseInstances\/Fa26\/assessments\/hw9\/infoAssessment\.json/, `courseInstances/Fa26/assessments/hw9/infoAssessment.json`],
      [["tag", "add", "brand-new"], /infoCourse\.json:\d+:\d+/],
      [["assessment-set", "add", "Lab"], /infoCourse\.json:\d+:\d+/],
    ];
    for (const [args, shown, file] of cases) {
      const preview = await runCliAt(course, ...args);
      assert.equal(preview.code, 0, preview.stderr);
      assert.match(preview.stdout, shown);
      assert.match(preview.stdout, /Would add 1 .*\. Rerun with --write/);
      assert.equal(fs.readFileSync(infoCourse, "utf-8"), before);
      if (file) {
        assert.equal(fs.existsSync(path.join(course, file)), false);
      }
    }
    for (const [args, , file] of cases) {
      const written = await runCliAt(course, ...args, "--write");
      assert.equal(written.code, 0, written.stderr);
      assert.match(written.stdout, /Added 1 /);
      if (file) {
        assert.ok(fs.existsSync(path.join(course, file)));
      }
    }

    const { code, stdout } = await runCliAt(course, "qid", "list");
    assert.equal(code, 0);
    assert.match(stdout, /unit1\/new/);
    assert.match((await runCliAt(course, "assessment", "list")).stdout, /Fa26\/hw9/);
    assert.match((await runCliAt(course, "tag", "list")).stdout, /brand-new/);
    assert.match((await runCliAt(course, "assessment-set", "list")).stdout, /Lab/);
  });
});

test("add passes flags to the fields, and prints what it resolved", async () => {
  await withAssessmentCourse(async (course) => {
    const { code, stdout } = await runCliAt(
      course, "assessment", "add", "--write", "--title=Midterm", "--set", "Exam", "--type", "Exam", "Fa26/mid"
    );
    assert.equal(code, 0);
    assert.match(stdout, /title: Midterm/);
    assert.match(stdout, /number: 1/);
    const info = JSON.parse(fs.readFileSync(
      path.join(course, "courseInstances/Fa26/assessments/mid/infoAssessment.json"), "utf-8"
    ));
    assert.deepEqual(
      { ...info, uuid: undefined },
      { uuid: undefined, type: "Exam", title: "Midterm", set: "Exam", number: "1", zones: [] }
    );
    assert.match(info.uuid, /^[0-9a-f-]{36}$/);
  });
});

test("add warns about an undefined topic on stderr", async () => {
  await withAssessmentCourse(async (course) => {
    const { code, stderr } = await runCliAt(course, "qid", "add", "--topic", "Nope", "fresh");
    assert.equal(code, 0);
    assert.match(stderr, /^Warning: Topic "Nope" is not defined/);
  });
});

test("add validates its arguments and leaves the course alone", async () => {
  await withAssessmentCourse(async (course) => {
    const cases: [string[], RegExp][] = [
      [["qid", "add"], /^Exactly one QID is required/],
      [["qid", "add", "a", "b"], /^Exactly one QID is required/],
      [["qid", "add", "--bogus", "a"], /^Unknown option: --bogus/],
      [["qid", "add", "a", "--title"], /^Missing value for --title/],
      [["qid", "add", "--topic", "--write", "a"], /^Missing value for --topic/],
      [["tag", "add", "used"], /^Tag "used" is already defined/],
      [["assessment", "add", "Nope/hw"], /must start with a course instance: Fa26/],
    ];
    for (const [args, message] of cases) {
      const { code, stderr } = await runCliAt(course, ...args, "--write");
      assert.equal(code, 1);
      assert.match(stderr, message);
    }
    assert.equal(fs.existsSync(path.join(course, "questions/a")), false);
  });
});

test("remove previews and writes every noun with structural reference cleanup", async () => {
  await withAssessmentCourse(async (course) => {
    const preview = await runCliAt(course, "qid", "remove", "q");
    assert.equal(preview.code, 0, preview.stderr);
    assert.match(preview.stdout, /Remove directory questions\/q/);
    assert.match(preview.stdout, /Would remove 1 question/);
    assert.ok(fs.existsSync(path.join(course, "questions/q")));

    const written = await runCliAt(course, "qid", "remove", "--write", "q");
    assert.equal(written.code, 0, written.stderr);
    assert.equal(fs.existsSync(path.join(course, "questions/q")), false);
    const assessment = JSON.parse(fs.readFileSync(
      path.join(course, "courseInstances/Fa26/assessments/hw1/infoAssessment.json"),
      "utf-8"
    ));
    assert.deepEqual(assessment.zones, []);
  });

  await withAssessmentCourse(async (course) => {
    assert.equal((await runCliAt(course, "tag", "remove", "--write", "used")).code, 0);
    const infoCourse = JSON.parse(fs.readFileSync(path.join(course, "infoCourse.json"), "utf-8"));
    const question = JSON.parse(fs.readFileSync(path.join(course, "questions/q/info.json"), "utf-8"));
    assert.deepEqual(infoCourse.tags.map((tag: { name: string }) => tag.name), ["unused"]);
    assert.deepEqual(question.tags, []);
  });

  await withAssessmentCourse(async (course) => {
    const missing = await runCliAt(course, "assessment-set", "remove", "Homework");
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /provide --replacement/);
    const replaced = await runCliAt(
      course,
      "assessment-set", "remove", "--write", "--replacement", "Quiz", "Homework"
    );
    assert.equal(replaced.code, 0, replaced.stderr);
    const assessment = JSON.parse(fs.readFileSync(
      path.join(course, "courseInstances/Fa26/assessments/hw1/infoAssessment.json"),
      "utf-8"
    ));
    assert.equal(assessment.set, "Quiz");
  });

  await withAssessmentCourse(async (course) => {
    const replaced = await runCliAt(
      course,
      "assessment-set", "remove", "--write", "--replacement", "Practice Quiz", "Homework"
    );
    assert.equal(replaced.code, 0, replaced.stderr);
    const assessment = JSON.parse(fs.readFileSync(
      path.join(course, "courseInstances/Fa26/assessments/hw1/infoAssessment.json"),
      "utf-8"
    ));
    assert.equal(assessment.set, "Practice Quiz");
  });

  await withAssessmentCourse(async (course) => {
    const removed = await runCliAt(course, "assessment", "remove", "--write", "Fa26/hw1");
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(
      fs.existsSync(path.join(course, "courseInstances/Fa26/assessments/hw1")),
      false
    );
  });
});

test("qid remove drops a question block when all of its alternatives are removed", async () => {
  await withAssessmentCourse(async (course) => {
    const assessmentFile = path.join(course, hw1, "infoAssessment.json");
    fs.writeFileSync(assessmentFile, JSON.stringify({
      zones: [{
        questions: [
          { alternatives: [{ id: "q" }], points: 3 },
          { id: "kept" },
        ],
      }],
    }, null, 2));

    const removed = await runCliAt(course, "qid", "remove", "--write", "q");
    assert.equal(removed.code, 0, removed.stderr);
    const assessment = JSON.parse(fs.readFileSync(assessmentFile, "utf-8"));
    assert.deepEqual(assessment.zones[0].questions, [{ id: "kept" }]);
  });
});

test("qid remove lowers numberChoose when pools and zones shrink", async () => {
  await withAssessmentCourse(async (course) => {
    const assessmentFile = path.join(course, hw1, "infoAssessment.json");
    fs.writeFileSync(assessmentFile, JSON.stringify({
      zones: [
        {
          numberChoose: 2,
          questions: [{ id: "q" }, { id: "kept" }],
        },
        {
          numberChoose: 2,
          questions: [{
            numberChoose: 2,
            alternatives: [{ id: "q" }, { id: "kept" }],
          }],
        },
      ],
    }, null, 2));

    const removed = await runCliAt(course, "qid", "remove", "--write", "q");
    assert.equal(removed.code, 0, removed.stderr);
    const assessment = JSON.parse(fs.readFileSync(assessmentFile, "utf-8"));
    assert.equal(assessment.zones[0].numberChoose, 1);
    assert.equal(assessment.zones[1].numberChoose, 1);
    assert.equal(assessment.zones[1].questions[0].numberChoose, 1);
  });
});

test("remove can deliberately leave additional references unchanged", async () => {
  await withAssessmentCourse(async (course) => {
    const assessmentFile = path.join(
      course,
      "courseInstances/Fa26/assessments/hw1/infoAssessment.json"
    );
    const before = fs.readFileSync(assessmentFile, "utf-8");
    const removed = await runCliAt(
      course,
      "qid", "remove", "--write", "--no-update-references", "q"
    );
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stderr, /will not be updated/);
    assert.equal(fs.readFileSync(assessmentFile, "utf-8"), before);
  });

  const conflict = await runCli(
    "assessment-set", "remove", "--no-update-references", "--replacement", "Quiz", "Homework"
  );
  assert.equal(conflict.code, 1);
  assert.match(conflict.stderr, /cannot be used with --no-update-references/);
});

test("tag add leaves infoCourse.json as it was if the write fails", async () => {
  await withAssessmentCourse(async (course) => {
    const infoCourse = path.join(course, "infoCourse.json");
    const before = fs.readFileSync(infoCourse, "utf-8");
    fs.chmodSync(infoCourse, 0o444);
    try {
      const { code } = await runCliAt(course, "tag", "add", "--write", "nope");
      assert.equal(code, 1);
      assert.equal(fs.readFileSync(infoCourse, "utf-8"), before);
    } finally {
      fs.chmodSync(infoCourse, 0o644);
    }
  });
});

test("createFiles removes what it made, and only that, when a file fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-navigator-create-"));
  try {
    const taken = path.join(root, "taken.txt");
    fs.writeFileSync(taken, "keep");
    const madeHere = path.join(root, "a/b/first.txt");
    assert.throws(() => createFiles([
      { file: madeHere, contents: "new" },
      { file: path.join(root, "second.txt"), contents: "new" },
      { file: taken, contents: "new" },
    ]), /EEXIST/);
    assert.deepEqual(fs.readdirSync(root), ["taken.txt"]);
    assert.equal(fs.readFileSync(taken, "utf-8"), "keep");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
