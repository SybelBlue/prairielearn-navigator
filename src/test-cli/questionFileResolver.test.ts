import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "vitest";
import {
  createQuestionFileResolver,
  type QuestionFileDescriptor,
} from "../core/questionFileResolver";

const cleanup: string[] = [];

afterEach(() => {
  for (const directory of cleanup.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("resolves local, inherited, file, and directory dependencies with partial diagnostics", async () => {
  const root = fixture();
  write(root, "clientFilesCourse/site.css", "body {}\n");
  write(root, "serverFilesCourse/grader/run.py", "pass\n");
  write(root, "serverFilesCourse/grader/data/nested.txt", "data\n");
  question(root, "base", {
    info: { title: "Base" },
    html: '<pl-code source-file-name="grader/run.py" directory="serverFilesCourse"></pl-code>',
    files: { "nested/base.txt": "base\n" },
  });
  question(root, "unit/child", {
    info: {
      title: "Child",
      template: "base",
      dependencies: {
        clientFilesCourseStyles: [
          "site.css",
          "missing.css",
          "{{dynamic}}.css",
          "../escape.css",
        ],
      },
      externalGradingOptions: { serverFilesCourse: ["grader"] },
    },
    html: [
      '<pl-figure file-name="img/pic.png"></pl-figure>',
      '<pl-figure file-name="{{params.image}}"></pl-figure>',
    ].join("\n"),
    files: {
      "clientFilesQuestion/img/pic.png": "png",
      "nested/local.txt": "local\n",
      "__pycache__/ignored.pyc": "ignored",
    },
  });

  const resolver = createQuestionFileResolver({
    courseRoot: root,
    questions: descriptors("base", "unit/child"),
  });
  const child = (await resolver.resolveAll()).get("unit/child")!;
  const byPath = new Map(
    child.files.map((file) => [file.path, file.provenance]),
  );

  assert.equal(
    byPath.get("questions/unit/child/nested/local.txt"),
    "question-local",
  );
  assert.equal(byPath.get("questions/base/nested/base.txt"), "template-local");
  assert.equal(byPath.get("clientFilesCourse/site.css"), "course-level");
  assert.equal(byPath.get("serverFilesCourse/grader/run.py"), "course-level");
  assert.equal(
    byPath.get("serverFilesCourse/grader/data/nested.txt"),
    "course-level",
  );
  assert.ok(!byPath.has("questions/unit/child/__pycache__/ignored.pyc"));
  assert.equal(child.complete, false);
  assert.ok(
    child.diagnostics.some((diagnostic) => diagnostic.includes("missing.css")),
  );
  assert.ok(
    child.diagnostics.some((diagnostic) =>
      diagnostic.includes("dynamic reference"),
    ),
  );
  assert.ok(
    child.diagnostics.some((diagnostic) =>
      diagnostic.includes("must be a path inside clientFilesCourse/"),
    ),
  );
  assert.deepEqual(
    child.files,
    [...child.files].sort((a, b) => a.path.localeCompare(b.path)),
  );
});

test("rejects unsafe or non-normalized resolver inputs", async () => {
  const root = fixture();
  assert.throws(() =>
    createQuestionFileResolver({
      courseRoot: root,
      questions: [{ qid: "bad", directory: "questions/../outside" }],
    }),
  );
  const resolver = createQuestionFileResolver({
    courseRoot: root,
    questions: [],
  });
  await assert.rejects(resolver.update(["../outside"]));
  await assert.rejects(resolver.update(["questions\\q\\info.json"]));
});

test("reports template cycles without hiding either question", async () => {
  const root = fixture();
  question(root, "a", { info: { template: "b" } });
  question(root, "b", { info: { template: "a" } });
  const resolutions = await createQuestionFileResolver({
    courseRoot: root,
    questions: descriptors("a", "b"),
  }).resolveAll();

  for (const qid of ["a", "b"]) {
    const resolution = resolutions.get(qid)!;
    assert.equal(resolution.complete, false);
    assert.ok(
      resolution.files.some(
        (file) => file.path === `questions/${qid}/info.json`,
      ),
    );
    assert.ok(
      resolution.diagnostics.some((diagnostic) =>
        diagnostic.includes("Template cycle"),
      ),
    );
  }
});

test("invalidates only local, inherited, and reverse-dependent questions", async () => {
  const root = fixture();
  write(root, "clientFilesCourse/one.css", "one\n");
  write(root, "clientFilesCourse/two.css", "two\n");
  question(root, "base", { info: {}, files: { "local.txt": "base\n" } });
  question(root, "child", { info: { template: "base" } });
  question(root, "shared", {
    info: { dependencies: { clientFilesCourseStyles: ["one.css"] } },
  });
  question(root, "other", { info: {} });
  const questions = descriptors("base", "child", "shared", "other");
  const resolver = createQuestionFileResolver({ courseRoot: root, questions });
  await resolver.resolveAll();

  assert.deepEqual(
    (await resolver.update(["questions/base/local.txt"])).affectedQids,
    ["base", "child"],
  );
  assert.deepEqual(
    (await resolver.update(["clientFilesCourse/one.css"])).affectedQids,
    ["shared"],
  );

  write(
    root,
    "questions/shared/info.json",
    JSON.stringify({
      dependencies: { clientFilesCourseStyles: ["two.css"] },
    }),
  );
  assert.deepEqual(
    (await resolver.update(["questions/shared/info.json"])).affectedQids,
    ["shared"],
  );
  assert.deepEqual(
    (await resolver.update(["clientFilesCourse/one.css"])).affectedQids,
    [],
  );
  assert.deepEqual(
    (await resolver.update(["clientFilesCourse/two.css"])).affectedQids,
    ["shared"],
  );
  assert.deepEqual(
    (await resolver.update([".pl-navigator.jsonc"])).affectedQids,
    ["base", "child", "other", "shared"],
  );

  question(root, "waiting", { info: { template: "future" } });
  const withMissingTemplate = [...questions, ...descriptors("waiting")];
  await resolver.update(["questions/waiting/info.json"], withMissingTemplate);
  question(root, "future", { info: {}, files: { "future.txt": "ready\n" } });
  const reconciled = await resolver.update(
    [],
    [...withMissingTemplate, ...descriptors("future")],
  );
  assert.deepEqual(reconciled.affectedQids, ["future", "waiting"]);
  assert.equal(
    reconciled.resolutions
      .get("waiting")
      ?.files.some((file) => file.path === "questions/future/future.txt"),
    true,
  );
});

test.runIf(process.platform !== "win32")(
  "does not follow symbolic links outside the course",
  async () => {
    const root = fixture();
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "pl-navigator-outside-"),
    );
    cleanup.push(outside);
    write(outside, "secret.txt", "secret\n");
    question(root, "q", { info: {} });
    fs.symlinkSync(
      path.join(outside, "secret.txt"),
      path.join(root, "questions/q/external.txt"),
    );
    const resolution = (
      await createQuestionFileResolver({
        courseRoot: root,
        questions: descriptors("q"),
      }).resolveAll()
    ).get("q")!;
    assert.equal(resolution.complete, false);
    assert.ok(
      resolution.diagnostics.some((diagnostic) =>
        diagnostic.includes("escapes the course"),
      ),
    );
    assert.ok(
      !resolution.files.some((file) => file.path.endsWith("external.txt")),
    );
  },
);

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-navigator-resolver-"));
  cleanup.push(root);
  write(root, "infoCourse.json", "{}\n");
  return root;
}

function question(
  root: string,
  qid: string,
  options: {
    info: Record<string, unknown>;
    html?: string;
    files?: Record<string, string>;
  },
) {
  write(
    root,
    `questions/${qid}/info.json`,
    `${JSON.stringify(options.info)}\n`,
  );
  if (options.html !== undefined) {
    write(root, `questions/${qid}/question.html`, options.html);
  }
  for (const [relative, contents] of Object.entries(options.files ?? {})) {
    write(root, `questions/${qid}/${relative}`, contents);
  }
}

function write(root: string, relative: string, contents: string) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function descriptors(...qids: string[]): QuestionFileDescriptor[] {
  return qids.map((qid) => ({ qid, directory: `questions/${qid}` }));
}
