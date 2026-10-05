import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "vitest";
import {
  checkAssessment,
  checkDuplicateQuestionIds,
  incompleteQuestionDiagnosticCode,
} from "../core/checks";
import { findCourseRoot } from "../core/course";
import { offsetToPosition } from "../core/diagnostic";

const fixtures = path.join(__dirname, "fixtures");
const brokenCourse = path.join(fixtures, "broken");
const brokenAssessment = path.join(
  brokenCourse,
  "courseInstances/Fa26/assessments/hw1/infoAssessment.json"
);
const brokenText = fs.readFileSync(brokenAssessment, "utf-8");

function idsOf(text: string, ds: { startOffset: number; endOffset: number }[]) {
  return ds.map((d) => text.slice(d.startOffset, d.endOffset));
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

test("duplicate ids warn on every occurrence", () => {
  const ds = checkDuplicateQuestionIds(brokenText);
  assert.deepEqual(idsOf(brokenText, ds), ["good", "good"]);
  assert.ok(ds.every((d) => d.severity === "warning"));
  assert.equal(ds[0].message, 'Duplicate question ID: "good" appears 2 times');
});

test("checkAssessment reports missing and incomplete questions", () => {
  const ds = checkAssessment(brokenText, brokenCourse);
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
  assert.ok(errors.every((d) => d.code === incompleteQuestionDiagnosticCode));
  assert.equal(
    errors[0].related?.[0].path,
    path.join(brokenCourse, "questions/noHtml/question.html")
  );
});

test("offsetToPosition is 1-based", () => {
  assert.deepEqual(offsetToPosition("ab\ncd", 0), { line: 1, column: 1 });
  assert.deepEqual(offsetToPosition("ab\ncd", 4), { line: 2, column: 2 });
});
