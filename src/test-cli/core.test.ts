import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "vitest";
import { loadConfig } from "../core/config";
import { parseJsonDoc, rangeOf } from "../core/json";
import { matchesRange, validatePlVersion } from "../core/plVersion";
import { fileRefAt, findFileRefs, sourceOf } from "../core/references";
import { rules } from "../core/rules/registry";
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
  assert.deepEqual(schema.properties.rules.propertyNames.enum, Object.keys(rules));
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
  const course = "/course";
  const fileDir = "/course/elements/el";
  const refs = findFileRefs(sourceOf(text), "elements/el/info.json", "2026-01-01", {
    courseRoot: course,
    fileDir,
  });
  assert.deepEqual(
    refs.map((r) => [r.kind, r.jsonPath?.join("."), r.target]),
    [
      ["elementFile", "controller", "/course/elements/el/el.py"],
      ["clientFilesCourse", "dependencies.clientFilesCourseScripts.0", "/course/clientFilesCourse/lib/a.js"],
      ["elementFile", "dependencies.elementStyles.0", "/course/elements/el/el.css"],
      ["clientFilesCourse", "dynamicDependencies.clientFilesCourseScripts.lib", "/course/clientFilesCourse/lib/b.js"],
    ]
  );
});

test("fileRefAt finds the reference under the cursor", () => {
  const file = path.join(brokenCourse, "courseInstances/Fa26/assessments/hw1/infoAssessment.json");
  const text = fs.readFileSync(file, "utf-8");
  const doc = sourceOf(text);
  const ctx = { courseRoot: brokenCourse, fileDir: path.dirname(file) };
  const rel = "courseInstances/Fa26/assessments/hw1/infoAssessment.json";

  const ref = fileRefAt(doc, rel, "2026-01-01", ctx, text.indexOf("topic/nested") + 3);
  assert.equal(ref?.value, "topic/nested");
  assert.equal(ref?.target, path.join(brokenCourse, "questions/topic/nested/question.html"));

  const infoOnly = fileRefAt(doc, rel, "2026-01-01", ctx, text.indexOf("noHtml"));
  assert.equal(infoOnly?.target, path.join(brokenCourse, "questions/noHtml/info.json"));

  assert.equal(fileRefAt(doc, rel, "2026-01-01", ctx, text.indexOf("Homework")), undefined);
});

test("pl-figure references resolve by directory and skip what cannot be known", () => {
  const file = path.join(brokenCourse, "questions/figures/question.html");
  const text = fs.readFileSync(file, "utf-8");
  const refs = findFileRefs(sourceOf(text), "questions/figures/question.html", "2026-01-01", {
    courseRoot: brokenCourse,
    fileDir: path.dirname(file),
  });
  const q = path.join(brokenCourse, "questions/figures/clientFilesQuestion");
  const c = path.join(brokenCourse, "clientFilesCourse");
  assert.deepEqual(
    refs.map((r) => [text.slice(r.startOffset, r.endOffset), r.target, r.problem]),
    [
      ["img/here.png", path.join(q, "img/here.png"), undefined],
      ["missing.png", path.join(q, "missing.png"), undefined],
      ["exists.css", path.join(c, "exists.css"), undefined],
      ["gone.png", path.join(c, "gone.png"), undefined],
      ["serverFilesCourse", null, 'invalid pl-figure directory "serverFilesCourse": must be "clientFilesQuestion" or "clientFilesCourse"'],
      ["../../escape.png", null, '"../../escape.png" must be a path inside clientFilesQuestion/'],
    ]
  );
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
