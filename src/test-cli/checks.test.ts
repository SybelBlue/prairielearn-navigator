import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "vitest";
import { loadConfig } from "../core/config";
import { findCourseRoot } from "../core/course";
import { offsetToPosition } from "../core/diagnostic";
import { ruleDiagnosticCode } from "../core/rules/registry";
import { runRules } from "../core/rules/run";
import { SchemaStore } from "../core/schemas";

const fixtures = path.join(__dirname, "fixtures");
const brokenCourse = path.join(fixtures, "broken");
const brokenAssessment = path.join(
  brokenCourse,
  "courseInstances/Fa26/assessments/hw1/infoAssessment.json"
);
const brokenText = fs.readFileSync(brokenAssessment, "utf-8");

async function checkAssessment() {
  const { config } = loadConfig(brokenCourse);
  return runRules(brokenAssessment, brokenText, {
    courseRoot: brokenCourse,
    config: { ...config, rules: { schema: "off" } },
    schemas: new SchemaStore({ cacheDir: config.schemaCacheDir }),
  });
}

test("findCourseRoot finds the nearest infoCourse.json", () => {
  assert.equal(findCourseRoot(brokenAssessment), brokenCourse);
  assert.equal(
    findCourseRoot(
      path.join(fixtures, "noCourse/assessments/hw1/infoAssessment.json")
    ),
    null
  );
});

test("assessments report missing, incomplete, and duplicate questions", async () => {
  const ds = await checkAssessment();
  const summary = ds.map((d) => [
    brokenText.slice(d.startOffset, d.endOffset),
    d.severity,
    d.message,
  ]);
  assert.deepEqual(summary, [
    ["good", "warning", 'Duplicate question ID: "good" appears 2 times'],
    ["noHtml", "error", "incomplete question: missing required html file"],
    ["noInfo", "error", "incomplete question: missing required JSON file"],
    [
      "doesNotExist",
      "error",
      `missing question: expected question directory ${path.join(
        brokenCourse,
        "questions",
        "doesNotExist"
      )}`,
    ],
    ["good", "warning", 'Duplicate question ID: "good" appears 2 times'],
  ]);

  const errors = ds.filter((d) => d.severity === "error");
  assert.ok(errors.every((d) => d.code === ruleDiagnosticCode("question-exists")));
  assert.equal(
    errors[0].related?.[0].path,
    path.join(brokenCourse, "questions/noHtml/question.html")
  );
});

test("offsetToPosition is 1-based", () => {
  assert.deepEqual(offsetToPosition("ab\ncd", 0), { line: 1, column: 1 });
  assert.deepEqual(offsetToPosition("ab\ncd", 4), { line: 2, column: 2 });
});
