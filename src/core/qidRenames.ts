import * as fs from "node:fs";
import * as path from "node:path";
import { ReferenceIndex } from "./referenceIndex";

export interface QidRename {
  oldQid: string;
  newQid: string;
}

export interface QidReferenceEdit extends QidRename {
  file: string;
  startOffset: number;
  endOffset: number;
  start: { line: number; column: number };
  end: { line: number; column: number };
  expected: string;
  replacement: string;
}

export interface QidReferenceFileChange {
  file: string;
  original: string;
  updated: string;
}

/** Returns a problem with a QID, or undefined when it is a safe relative path. */
export function qidProblem(qid: string): string | undefined {
  if (qid.length === 0) {
    return "QIDs must not be empty";
  }
  if (
    qid.includes("\\") ||
    path.posix.isAbsolute(qid) ||
    /^[A-Za-z]:/.test(qid)
  ) {
    return `QID "${qid}" must be a relative path using forward slashes`;
  }
  if (qid.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    return `QID "${qid}" must not contain empty, ".", or ".." path segments`;
  }
  return undefined;
}

/** The absolute directory named by a validated QID. */
export function qidDirectory(courseRoot: string, qid: string): string {
  return path.join(courseRoot, "questions", ...qid.split("/"));
}

/**
 * Plans every semantic question-reference replacement for explicit QID
 * mappings. The index supplies exact source ranges and includes references to
 * questions whose directories do not currently exist.
 */
export function planQidReferenceRenames(
  index: ReferenceIndex,
  renames: readonly QidRename[]
): QidReferenceEdit[] {
  const byOldQid = new Map<string, string>();
  for (const { oldQid, newQid } of renames) {
    const problem = qidProblem(oldQid) ?? qidProblem(newQid);
    if (problem) {
      throw new Error(problem);
    }
    if (oldQid === newQid) {
      throw new Error(`QID "${oldQid}" cannot be renamed to itself`);
    }
    const existing = byOldQid.get(oldQid);
    if (existing !== undefined && existing !== newQid) {
      throw new Error(
        `Conflicting QID renames for "${oldQid}": "${existing}" and "${newQid}"`
      );
    }
    byOldQid.set(oldQid, newQid);
  }

  const edits = new Map<string, QidReferenceEdit>();
  for (const [oldQid, newQid] of byOldQid) {
    const oldDir = qidDirectory(index.courseRoot, oldQid);
    for (const use of index.usesOf(oldDir)) {
      if (
        use.ref.spec.target !== "question" ||
        use.ref.target !== oldDir
      ) {
        continue;
      }
      const key = `${use.file}\0${use.ref.startOffset}\0${use.ref.endOffset}`;
      const edit: QidReferenceEdit = {
        oldQid,
        newQid,
        file: use.file,
        startOffset: use.ref.startOffset,
        endOffset: use.ref.endOffset,
        start: use.start,
        end: use.end,
        expected: use.ref.value,
        replacement: newQid,
      };
      const existing = edits.get(key);
      if (existing && existing.replacement !== edit.replacement) {
        throw new Error(
          `Conflicting replacements for ${use.file}:${use.start.line}:${use.start.column}`
        );
      }
      edits.set(key, edit);
    }
  }

  return [...edits.values()].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.startOffset - b.startOffset ||
      a.endOffset - b.endOffset
  );
}

/**
 * Reads and validates every affected file, then returns their complete updated
 * contents without writing anything.
 */
export function prepareQidReferenceFileChanges(
  edits: readonly QidReferenceEdit[]
): QidReferenceFileChange[] {
  const byFile = new Map<string, QidReferenceEdit[]>();
  for (const edit of edits) {
    const fileEdits = byFile.get(edit.file) ?? [];
    fileEdits.push(edit);
    byFile.set(edit.file, fileEdits);
  }

  const changes: QidReferenceFileChange[] = [];
  for (const file of [...byFile.keys()].sort()) {
    const original = fs.readFileSync(file, "utf-8");
    const fileEdits = byFile.get(file)!.sort(
      (a, b) => b.startOffset - a.startOffset || b.endOffset - a.endOffset
    );
    let nextStart = original.length;
    for (const edit of fileEdits) {
      if (edit.endOffset > nextStart) {
        throw new Error(
          `Overlapping QID edits in ${file}:${edit.start.line}:${edit.start.column}`
        );
      }
      if (
        edit.startOffset < 0 ||
        edit.endOffset < edit.startOffset ||
        original.slice(edit.startOffset, edit.endOffset) !== edit.expected
      ) {
        throw new Error(
          `QID reference changed before it could be updated at ${file}:${edit.start.line}:${edit.start.column}`
        );
      }
      nextStart = edit.startOffset;
    }

    let updated = original;
    for (const edit of fileEdits) {
      updated =
        updated.slice(0, edit.startOffset) +
        edit.replacement +
        updated.slice(edit.endOffset);
    }
    changes.push({ file, original, updated });
  }
  return changes;
}
