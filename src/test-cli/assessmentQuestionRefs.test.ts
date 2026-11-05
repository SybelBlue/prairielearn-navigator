import * as assert from "node:assert/strict";
import { test } from "vitest";
import { assessmentQuestionRefs } from "../core/assessmentQuestionRefs";
import { refSpecs } from "../core/references/specs";

/** The refs as [kind, id] pairs, checking each one's offsets against `text`. */
function refs(text: string): [string, string][] {
  return assessmentQuestionRefs(text).map((ref) => {
    assert.equal(text.slice(ref.startOffset, ref.endOffset), ref.id);
    return [ref.kind, ref.id];
  });
}

test("lists questions and alternatives across zones in document order", () => {
  const text = JSON.stringify({
    zones: [
      {
        questions: [
          { id: "a" },
          { numberChoose: 1, alternatives: [{ id: "b1" }, { id: "b2" }] },
          { id: "c" },
        ],
      },
      { questions: [{ id: "d", alternatives: [{ id: "d1" }] }] },
    ],
  }, null, 2);
  assert.deepEqual(refs(text), [
    ["question", "a"],
    ["alternative", "b1"],
    ["alternative", "b2"],
    ["question", "c"],
    ["question", "d"],
    ["alternative", "d1"],
  ]);
});

test("keeps duplicate ids", () => {
  const text = '{"zones": [{"questions": [{"id": "q"}, {"alternatives": [{"id": "q"}]}]}, {"questions": [{"id": "q"}]}]}';
  assert.deepEqual(refs(text), [
    ["question", "q"],
    ["alternative", "q"],
    ["question", "q"],
  ]);
});

test("allows comments and trailing commas", () => {
  const text = `{
    // line comment
    "zones": [
      /* block */ { "questions": [ { "id": "x/y", }, ], },
    ],
  }`;
  assert.deepEqual(refs(text), [["question", "x/y"]]);
});

test("ignores ids outside zones, and non-string ids", () => {
  assert.deepEqual(refs('{"title": "No zones", "questions": [{"id": "q"}]}'), []);
  assert.deepEqual(refs('{"zones": [{"questions": [{"id": 3}, {"id": null}, {"id": "ok"}]}]}'), [["question", "ok"]]);
  assert.deepEqual(refs(""), []);
  assert.deepEqual(refs("[]"), []);
});

test("returns the refs it recovers from malformed text without throwing", () => {
  // Missing comma between questions, and the document is cut off.
  const text = '{"zones": [{"questions": [{"id": "a"} {"id": "b"}, {"alternatives": [{"id": "c"';
  assert.deepEqual(refs(text), [
    ["question", "a"],
    ["question", "b"],
    ["alternative", "c"],
  ]);
  assert.doesNotThrow(() => assessmentQuestionRefs('{"zones": [{"questions": [{"id": "unterminated'));
  assert.doesNotThrow(() => assessmentQuestionRefs("}{]["));
});

test("reads specs that apply to every PrairieLearn version", () => {
  // assessmentQuestionRefs selects specs with a fixed date; this keeps that valid.
  const ids = ["assessment.question", "assessment.alternative"];
  for (const id of ids) {
    const spec = refSpecs.find((s) => s.id === id);
    assert.ok(spec, id);
    assert.equal(spec.range, "*");
    assert.equal(spec.rule, "question-exists");
  }
});
