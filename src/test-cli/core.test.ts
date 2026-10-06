import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "vitest";
import { isExcluded, loadConfig } from "../core/config";
import { findElements } from "../core/html";
import { parseJsonDoc, rangeOf } from "../core/json";
import { matchesRange, validatePlVersion } from "../core/plVersion";
import { indexCourse } from "../core/referenceIndex";
import { fileRefAt, findFileRefs, openTarget, sourceOf } from "../core/references/extract";
import { RefSpec, refSpecs } from "../core/references/specs";
import { isRuleId, rules } from "../core/rules/registry";
import { isCheckable, runRules, selectRules } from "../core/rules/run";
import { RuleImpl } from "../core/rules/types";
import { SchemaStore } from "../core/schemas";

const fixtures = path.join(__dirname, "fixtures");
const brokenCourse = path.join(fixtures, "broken");
const schemaCache = path.join(fixtures, "schema-cache");
const pinnedSha = "151aabd1167dbdc170c50f71295a74de9f31db05";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pl-navigator-test-"));
}

// ── Versions ──

test("PL versions are latest, dates, or commit shas", () => {
  assert.equal(validatePlVersion("latest"), undefined);
  assert.equal(validatePlVersion("2025-06-01"), undefined);
  assert.equal(validatePlVersion(pinnedSha), undefined);
  assert.match(validatePlVersion("2025-13-45") ?? "", /invalid plVersion/);
  assert.match(validatePlVersion("1.2.3") ?? "", /invalid plVersion/);
  assert.match(validatePlVersion(3) ?? "", /must be a string/);
});

test("version ranges are conjunctions of date comparisons", () => {
  assert.ok(matchesRange("*", "2020-01-01"));
  assert.ok(matchesRange(">=2023-05-01 <2025-04-17", "2024-01-01"));
  assert.ok(!matchesRange(">=2023-05-01 <2025-04-17", "2025-04-17"));
  assert.ok(matchesRange("<=2025-04-17", "2025-04-17"));
  assert.ok(matchesRange("2025-04-17", "2025-04-17"));
  assert.throws(() => matchesRange(">=v2", "2025-01-01"), /invalid version range/);
});

// ── JSON ──

test("parsed values are plain objects (ajv's deep equality needs valueOf)", () => {
  const { value } = parseJsonDoc('{ "a": { "b": 1 } }');
  assert.equal(Object.getPrototypeOf((value as { a: object }).a), Object.prototype);
});

test("rangeOf locates values and keys, falling back to ancestors", () => {
  const text = '{\n  // comment\n  "a": { "b": [1, "x"] }\n}';
  const doc = parseJsonDoc(text);
  assert.deepEqual(doc.errors, []);
  const slice = (r: { startOffset: number; endOffset: number }) =>
    text.slice(r.startOffset, r.endOffset);
  assert.equal(slice(rangeOf(doc, ["a", "b", 1])), '"x"');
  assert.equal(slice(rangeOf(doc, ["a", "b"], { key: true })), '"b"');
  assert.equal(slice(rangeOf(doc, ["a", "missing"])), '{ "b": [1, "x"] }');
});

// ── Config ──

test("config file values are resolved relative to the file", () => {
  const { config, file, problems } = loadConfig(brokenCourse);
  assert.deepEqual(problems, []);
  assert.equal(file, path.join(brokenCourse, ".pl-navigator.jsonc"));
  assert.equal(config.plVersion, pinnedSha);
  assert.equal(config.schemaCacheDir, schemaCache);
});

test("overrides take precedence over the config file", () => {
  const { config } = loadConfig(brokenCourse, {
    overrides: { plVersion: "2025-01-01", rules: { schema: "off" } },
  });
  assert.equal(config.plVersion, "2025-01-01");
  assert.equal(config.schemaCacheDir, schemaCache);
  assert.deepEqual(config.rules, { schema: "off" });
});

test("without a config file, defaults apply", () => {
  const dir = tmpDir();
  const { config, file, problems } = loadConfig(dir);
  assert.equal(file, undefined);
  assert.deepEqual(problems, []);
  assert.equal(config.plVersion, "latest");
  assert.match(config.schemaCacheDir, /prairielearn-navigator/);
});

test("excludes add up across sources and match relative to where they are declared", () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, ".pl-navigator.jsonc"),
    '{ "excludes": ["questions/archive/**"] }'
  );
  // Declared relative to the parent directory, as a workspace setting would be
  const { config, problems } = loadConfig(dir, {
    overrides: { excludes: [`${path.basename(dir)}/**/*.html`] },
    overridesBaseDir: path.dirname(dir),
  });
  assert.deepEqual(problems, []);
  const at = (rel: string) => path.join(dir, rel);
  assert.ok(isExcluded(config, at("questions/archive/old/info.json")));
  assert.ok(!isExcluded(config, at("questions/current/info.json")));
  assert.ok(isExcluded(config, at("questions/current/question.html")));
  assert.ok(!isExcluded(config, "/elsewhere/questions/archive/q/info.json"));

  const bad = loadConfig(null, { overrides: { excludes: "questions/**" } });
  assert.match(bad.problems[0].message, /excludes must be an array/);
});

test("invalid config values are reported and replaced by defaults", () => {
  const { config, problems } = loadConfig(null, {
    configPath: path.join(fixtures, "configs/invalid.jsonc"),
  });
  assert.equal(config.plVersion, "latest");
  assert.deepEqual(
    problems.map((p) => [p.severity, p.message.split(":")[0]]),
    [
      ["error", 'invalid plVersion "v1.2.3"'],
      ["warning", 'unknown config key "colour"'],
      ["warning", 'unknown rule "nope"'],
    ]
  );
});

// ── Rule registry ──

test("the first entry matching both version and glob wins", () => {
  const impl = (name: string): RuleImpl => () => [
    { startOffset: 0, endOffset: 0, message: name, severity: "error" },
  ];
  const table = {
    r: [
      [">=2025-01-01", "questions/**/info.json", impl("new")],
      ["*", "questions/**/info.json", impl("old")],
      ["*", "infoCourse.json", impl("course")],
    ],
    other: [["<2020-01-01", "questions/**/info.json", impl("ancient")]],
  } as const;
  const names = (relPath: string, date: string) =>
    selectRules(relPath, date, table).map(([id, f]) => `${id}:${(f({} as never) as { message: string }[])[0].message}`);

  assert.deepEqual(names("questions/a/b/info.json", "2026-01-01"), ["r:new"]);
  assert.deepEqual(names("questions/a/info.json", "2024-06-01"), ["r:old"]);
  assert.deepEqual(names("questions/a/info.json", "2019-06-01"), ["r:old", "other:ancient"]);
  assert.deepEqual(names("infoCourse.json", "2026-01-01"), ["r:course"]);
  assert.deepEqual(names("elsewhere.json", "2026-01-01"), []);
});

test("the config file's JSON schema lists every rule id", () => {
  const schema = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../schemas/pl-navigator.schema.json"), "utf-8")
  );
  assert.deepEqual(
    [...schema.properties.rules.propertyNames.enum].sort(),
    Object.keys(rules).sort()
  );
});

test("isCheckable covers every PL course JSON file", () => {
  for (const p of [
    "infoCourse.json",
    "courseInstances/Fa26/infoCourseInstance.json",
    "courseInstances/Fa26/assessments/hw1/infoAssessment.json",
    "questions/topic/q1/info.json",
    "elements/my-element/info.json",
    "elementExtensions/pl-thing/ext/info.json",
    "questions/topic/q1/question.html",
  ]) {
    assert.ok(isCheckable(p), p);
  }
  assert.ok(!isCheckable("clientFilesCourse/data.json"));
});

test("runRules stamps rule codes and applies severity overrides", async () => {
  const file = path.join(brokenCourse, "questions/deps/info.json");
  const text = fs.readFileSync(file, "utf-8");
  const { config } = loadConfig(brokenCourse);
  const schemas = new SchemaStore({ cacheDir: config.schemaCacheDir });

  const ds = await runRules(file, text, { courseRoot: brokenCourse, config, schemas });
  assert.deepEqual(
    ds.map((d) => [text.slice(d.startOffset, d.endOffset), d.severity, d.code]),
    [
      ["missing.css", "error", "prairielearn-navigator/client-files-course-exist"],
      ["../escape.js", "error", "prairielearn-navigator/client-files-course-exist"],
    ]
  );

  const relaxed = { ...config, rules: { "client-files-course-exist": "warning" as const } };
  const warned = await runRules(file, text, { courseRoot: brokenCourse, config: relaxed, schemas });
  assert.ok(warned.every((d) => d.severity === "warning"));

  const off = { ...config, rules: { "client-files-course-exist": "off" as const } };
  assert.deepEqual(await runRules(file, text, { courseRoot: brokenCourse, config: off, schemas }), []);
});

// ── File references ──

test("findFileRefs resolves every file-valued field", () => {
  const text = JSON.stringify({
    controller: "el.py",
    dependencies: {
      clientFilesCourseScripts: ["lib/a.js"],
      elementStyles: ["el.css"],
      nodeModulesScripts: ["ignored.js"],
    },
    dynamicDependencies: { clientFilesCourseScripts: { lib: "lib/b.js" } },
  });
  const refs = findFileRefs(sourceOf(text), "elements/el/info.json", "2026-01-01", {
    courseRoot: "/course",
    fileDir: "/course/elements/el",
  });
  assert.deepEqual(
    refs.map((r) => [r.spec.rule, r.value, r.target]),
    [
      ["element-files-exist", "el.py", "/course/elements/el/el.py"],
      ["client-files-course-exist", "lib/a.js", "/course/clientFilesCourse/lib/a.js"],
      ["element-files-exist", "el.css", "/course/elements/el/el.css"],
      ["client-files-course-exist", "lib/b.js", "/course/clientFilesCourse/lib/b.js"],
    ]
  );
});

test("question references target the question directory and open its html", () => {
  const rel = "courseInstances/Fa26/assessments/hw1/infoAssessment.json";
  const file = path.join(brokenCourse, rel);
  const text = fs.readFileSync(file, "utf-8");
  const refs = findFileRefs(sourceOf(text), rel, "2026-01-01", {
    courseRoot: brokenCourse,
    fileDir: path.dirname(file),
  });

  const ref = fileRefAt(refs, text.indexOf("topic/nested") + 3);
  assert.equal(ref?.value, "topic/nested");
  assert.equal(ref?.target, path.join(brokenCourse, "questions/topic/nested"));
  assert.equal(openTarget(ref!), path.join(brokenCourse, "questions/topic/nested/question.html"));

  const infoOnly = fileRefAt(refs, text.indexOf("noHtml"));
  assert.equal(openTarget(infoOnly!), path.join(brokenCourse, "questions/noHtml/info.json"));

  assert.equal(fileRefAt(refs, text.indexOf("Homework")), undefined);
});

function htmlRefs(question: string) {
  const file = path.join(brokenCourse, "questions", question, "question.html");
  const text = fs.readFileSync(file, "utf-8");
  const refs = findFileRefs(sourceOf(text), `questions/${question}/question.html`, "2026-01-01", {
    courseRoot: brokenCourse,
    fileDir: path.dirname(file),
  });
  const rel = (p: string | null) => p && path.relative(brokenCourse, p);
  return refs.map((r) => [r.spec.id, text.slice(r.startOffset, r.endOffset), rel(r.target), r.problem]);
}

test("findElements is linear on unclosed and pathological tags", () => {
  const started = Date.now();
  findElements("<pl-figure ".repeat(100_000), "pl-figure");
  findElements('<pl-figure a="' + "x".repeat(1_000_000), "pl-figure");
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started}ms`);
  // A tag inside another tag's quoted value is not a tag
  assert.equal(findElements('<pl-figure alt="<pl-figure file-name=x>" file-name="y">', "pl-figure").length, 1);
  assert.equal(findElements("<pl-figure-like file-name=x>", "pl-figure").length, 0);
});

test("pl-figure references resolve by directory and skip what cannot be known", () => {
  assert.deepEqual(htmlRefs("figures"), [
    ["pl-figure", "img/here.png", "questions/figures/clientFilesQuestion/img/here.png", undefined],
    ["pl-figure", "missing.png", "questions/figures/clientFilesQuestion/missing.png", undefined],
    ["pl-figure", "exists.css", "clientFilesCourse/exists.css", undefined],
    ["pl-figure", "gone.png", "clientFilesCourse/gone.png", undefined],
    ["pl-figure", "serverFilesCourse", null, 'invalid pl-figure directory "serverFilesCourse": must be "clientFilesQuestion" or "clientFilesCourse"'],
    ["pl-figure", "../../escape.png", null, '"../../escape.png" must be a path inside clientFilesQuestion/'],
  ]);
});

test("every element with a source file resolves its directory like PrairieLearn", () => {
  const q = "questions/allElements";
  assert.deepEqual(htmlRefs("allElements"), [
    ["pl-file-download", "data.csv", `${q}/clientFilesQuestion/data.csv`, undefined],
    ["pl-file-download", "gone.csv", "clientFilesCourse/gone.csv", undefined],
    ["pl-code", "code.py", `${q}/code.py`, undefined],
    ["pl-code", "lib.py", "serverFilesCourse/lib.py", undefined],
    ["pl-code", "../..", null, 'pl-code directory "../.." must be inside the question directory'],
    ["pl-file-editor", "starter.py", `${q}/clientFilesQuestion/starter.py`, undefined],
    ["pl-graph", "graph.dot", `${q}/graph.dot`, undefined],
    ["pl-rich-text-editor", "code.py", `${q}/code.py`, undefined],
    ["pl-excalidraw", "drawing.excalidraw", "clientFilesCourse/drawing.excalidraw", undefined],
    ["pl-excalidraw", "somewhere", null, 'invalid pl-excalidraw directory "somewhere": must be one of ".", "clientFilesQuestion", "clientFilesCourse", "serverFilesCourse"'],
    ["pl-xss-safe", "code.py", `${q}/code.py`, undefined],
    ["pl-template", "tmpl.mustache", "serverFilesCourse/tmpl.mustache", undefined],
    ["pl-template", "other.mustache", `${q}/other.mustache`, undefined],
  ]);
});

test("references that escape their directory have no target", () => {
  const text = '{ "dependencies": { "clientFilesCourseStyles": ["../x.css", "/etc/passwd", "ok.css"] } }';
  const refs = findFileRefs(sourceOf(text), "questions/q/info.json", "2026-01-01", {
    courseRoot: "/course",
    fileDir: "/course/questions/q",
  });
  assert.deepEqual(
    refs.map((r) => r.target),
    [null, null, "/course/clientFilesCourse/ok.css"]
  );
});

// ── Reference table invariants ──

test("every reference spec has a registered rule, schema entry, and fixture", () => {
  const schema = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../schemas/pl-navigator.schema.json"), "utf-8")
  );
  const fixtureText = fs
    .globSync("**/{info.json,question.html,infoAssessment.json}", { cwd: brokenCourse })
    .map((f) => fs.readFileSync(path.join(brokenCourse, f), "utf-8"))
    .join("\n");
  for (const spec of refSpecs as readonly RefSpec[]) {
    assert.ok(isRuleId(spec.rule), `${spec.id}: unregistered rule ${spec.rule}`);
    assert.ok(schema.properties.rules.propertyNames.enum.includes(spec.rule), `${spec.id}: ${spec.rule} missing from schema`);
    if (spec.source === "html") {
      assert.equal(spec.rule, `${spec.html.tag}-file-exist`);
      assert.ok(fixtureText.includes(`<${spec.html.tag} `), `${spec.id}: no fixture`);
    } else {
      // The last literal key in the path, e.g. "clientFilesCourseScripts"
      const key = [...spec.json.json].reverse().find((k) => typeof k === "string" && k !== "*") ??
        String([...spec.json.json].reverse().find((k) => k instanceof RegExp)).replace(/^\/\^|\$\/$/g, "").replace(/\(.*$/, "");
      assert.ok(fixtureText.includes(`"${key}"`), `${spec.id}: no fixture for "${key}"`);
    }
  }
});

// ── Reverse index ──

test("the reference index answers uses of files and of directory targets", () => {
  const index = indexCourse(brokenCourse, "2026-01-01");
  const at = (rel: string) => path.join(brokenCourse, rel);
  const usesOf = (rel: string) =>
    index.usesOf(at(rel)).map((u) => `${path.relative(brokenCourse, u.file)}:${u.start.line}`);

  assert.deepEqual(usesOf("clientFilesCourse/exists.css"), [
    "elements/my-el/info.json:1",
    "questions/deps/info.json:7",
    "questions/figures/question.html:4",
  ]);
  // A question is used by everything referencing its directory
  assert.deepEqual(usesOf("questions/good/question.html"), [
    "courseInstances/Fa26/assessments/hw1/infoAssessment.json:10",
    "courseInstances/Fa26/assessments/hw1/infoAssessment.json:16",
    "questions/jsonRefs/info.json:6",
  ]);
  // A file reference does not make sibling files "used", and a question
  // only covers its own top-level files
  assert.deepEqual(usesOf("clientFilesCourse/other.css"), []);
  assert.deepEqual(usesOf("questions/figures/clientFilesQuestion/img/here.png"), [
    "questions/figures/question.html:2",
  ]);

  const deps = at("questions/deps/info.json");
  assert.deepEqual(index.filesAffectedBy(at("clientFilesCourse/missing.css")), [deps]);
  // A file inside a referenced question, and a directory holding targets
  assert.ok(index.filesAffectedBy(at("questions/good/info.json")).includes(
    at("courseInstances/Fa26/assessments/hw1/infoAssessment.json")
  ));
  assert.deepEqual(
    index.filesAffectedBy(at("questions/figures/clientFilesQuestion")),
    [at("questions/figures/question.html")]
  );
  assert.deepEqual(index.filesAffectedBy(at("questions/nothing/here.txt")), []);
  index.update(deps, "{}");
  assert.deepEqual(usesOf("clientFilesCourse/exists.css"), [
    "elements/my-el/info.json:1",
    "questions/figures/question.html:4",
  ]);
  index.remove(at("questions/figures/question.html"));
  assert.deepEqual(usesOf("clientFilesCourse/exists.css"), ["elements/my-el/info.json:1"]);
});

// ── Schemas ──

type FakeResponse = { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> };
function respond(status: number, body: unknown = ""): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

test("a pinned sha is served from the cache without fetching", async () => {
  const store = new SchemaStore({
    cacheDir: schemaCache,
    fetch: async () => assert.fail("unexpected fetch"),
  });
  const schema = await store.get("infoQuestion", pinnedSha);
  assert.equal(schema?.label, "151aabd");
  assert.equal(schema?.validate({ uuid: "00000000-0000-0000-0000-000000000002", type: "v3", title: "Q", topic: "T" }), true);
  assert.equal(schema?.validate({ type: "v3" }), false);
});

test("dates resolve via the GitHub API and old shas fall back to the old schema path", async () => {
  const cacheDir = tmpDir();
  const urls: string[] = [];
  const store = new SchemaStore({
    cacheDir,
    githubToken: "tok",
    fetch: async (url, init) => {
      urls.push(url);
      if (url.startsWith("https://api.github.com/")) {
        assert.equal(init?.headers?.authorization, "Bearer tok");
        return respond(200, [{ sha: "a".repeat(40) }]);
      }
      return url.includes("/apps/prairielearn/")
        ? respond(404)
        : respond(200, { type: "object", required: ["title"] });
    },
  });
  const schema = await store.get("infoQuestion", "2022-01-01");
  assert.equal(schema?.label, "2022-01-01 (aaaaaaa)");
  assert.equal(schema?.validate({}), false);
  assert.deepEqual(urls, [
    "https://api.github.com/repos/PrairieLearn/PrairieLearn/commits?sha=master&until=2022-01-01T23:59:59Z&per_page=1",
    `https://raw.githubusercontent.com/PrairieLearn/PrairieLearn/${"a".repeat(40)}/apps/prairielearn/src/schemas/schemas/infoQuestion.json`,
    `https://raw.githubusercontent.com/PrairieLearn/PrairieLearn/${"a".repeat(40)}/schemas/schemas/infoQuestion.json`,
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cacheDir, "refs.json"), "utf-8")), {
    "2022-01-01": "a".repeat(40),
  });
  assert.ok(fs.existsSync(path.join(cacheDir, "a".repeat(40), "infoQuestion.json")));

  // A second store reuses refs.json and the cached file
  const offline = new SchemaStore({ cacheDir, fetch: async () => assert.fail("unexpected fetch") });
  assert.equal((await offline.get("infoQuestion", "2022-01-01"))?.label, "2022-01-01 (aaaaaaa)");
});

test("latest fetches master and prunes older daily snapshots", async () => {
  const cacheDir = tmpDir();
  fs.mkdirSync(path.join(cacheDir, "master-2000-01-01"));
  const store = new SchemaStore({
    cacheDir,
    fetch: async (url) => {
      assert.match(url, /\/PrairieLearn\/master\/apps\//);
      return respond(200, { type: "object" });
    },
  });
  assert.match((await store.get("infoCourse", "latest"))?.label ?? "", /^latest \(\d{4}-\d{2}-\d{2}\)$/);
  assert.deepEqual(
    fs.readdirSync(cacheDir).map((d) => d.replace(/\d{4}-\d{2}-\d{2}$/, "DATE")),
    ["master-DATE"]
  );
});

test("unavailable schemas are recorded once, not thrown", async () => {
  const offline = new SchemaStore({
    cacheDir: tmpDir(),
    fetch: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  assert.equal(await offline.get("infoQuestion", "latest"), undefined);
  assert.equal(await offline.get("infoQuestion", "latest"), undefined);
  assert.equal(offline.problems.size, 1);
  assert.match([...offline.problems][0], /offline\?/);

  const limited = new SchemaStore({ cacheDir: tmpDir(), fetch: async () => respond(403) });
  assert.equal(await limited.get("infoQuestion", "2024-01-01"), undefined);
  assert.match([...limited.problems][0], /rate limited; set GITHUB_TOKEN/);
});
