import * as path from "node:path";
import { FileEdit } from "./fileEdits";
import { ReferenceIndex } from "./referenceIndex";

export interface QidRename {
  oldQid: string;
  newQid: string;
}

export type QidReferenceEdit = QidRename & FileEdit;

/** Returns a problem with an id, or undefined when it is a safe relative path. */
export function relativeIdProblem(noun: string, id: string): string | undefined {
  if (id.length === 0) {
    return `${noun}s must not be empty`;
  }
  if (
    id.includes("\\") ||
    path.posix.isAbsolute(id) ||
    /^[A-Za-z]:/.test(id)
  ) {
    return `${noun} "${id}" must be a relative path using forward slashes`;
  }
  if (id.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    return `${noun} "${id}" must not contain empty, ".", or ".." path segments`;
  }
  return undefined;
}

/** The absolute directory named by a validated QID. */
function qidDirectory(courseRoot: string, qid: string): string {
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
    const problem = relativeIdProblem("QID", oldQid) ?? relativeIdProblem("QID", newQid);
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
