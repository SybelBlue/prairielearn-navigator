import * as assert from "node:assert/strict";
import { test } from "vitest";
import * as library from "../library";

test("the library exports exactly its public API", () => {
  assert.deepEqual(Object.keys(library).sort(), [
    "assessmentQuestionRefs",
    "courseTags",
    "createQuestionFileResolver",
    "findCourseRoot",
    "implicitTagColor",
    "parseJsonDoc",
    "plBadgeColors",
    "plDefaultTag",
    "plDefaultTagList",
    "strictJsonErrors",
  ]);
});

test("plBadgeColors is frozen, entries included", () => {
  assert.ok(Object.isFrozen(library.plBadgeColors));
  for (const color of Object.values(library.plBadgeColors)) {
    assert.ok(Object.isFrozen(color));
  }
  assert.throws(() => {
    (library.plBadgeColors as Record<string, unknown>).red1 = { text: "#000", background: "#fff" };
  }, TypeError);
});

test("plDefaultTagList lists every default tag plDefaultTag finds", () => {
  const tags = library.plDefaultTagList();
  assert.ok(tags.length > 0);
  for (const tag of tags) {
    assert.equal(library.plDefaultTag(tag.name), tag);
  }
  assert.equal(library.plDefaultTag("not-a-default-tag"), undefined);
});
