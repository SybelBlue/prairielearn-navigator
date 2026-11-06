import * as path from "node:path";
import { findNodeAtLocation, getLocation, Node } from "jsonc-parser";
import { isWithinDir, relativeIdProblem } from "./courseFiles";
import { FileEdit } from "./fileEdits";
import { parseJsonDoc } from "./json";
import { removeJsonValues } from "./jsonEdits";
import { treeOf } from "./jsonTree";
import { ReferenceIndex } from "./referenceIndex";

export interface QidRename {
  oldQid: string;
  newQid: string;
}

export type QidReferenceEdit = QidRename & FileEdit;

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

/**
 * Plans structurally removing semantic references to QIDs. Assessment question
 * and alternative objects are removed; a question's legacy template property
 * is removed. References inside a directory being deleted are ignored.
 */
export function planQidReferenceRemovals(
  index: ReferenceIndex,
  qids: readonly string[],
  readText: (file: string) => string | undefined,
  deletedRoots: readonly string[] = []
): FileEdit[] {
  const unique = new Set<string>();
  for (const qid of qids) {
    const problem = relativeIdProblem("QID", qid);
    if (problem) {
      throw new Error(problem);
    }
    unique.add(qid);
  }

  const usesByFile = new Map<string, ReturnType<ReferenceIndex["usesOf"]>>();
  for (const qid of unique) {
    const dir = qidDirectory(index.courseRoot, qid);
    for (const use of index.usesOf(dir)) {
      if (
        use.ref.spec.target !== "question" ||
        use.ref.target !== dir ||
        deletedRoots.some((root) => isWithinDir(root, use.file))
      ) {
        continue;
      }
      const uses = usesByFile.get(use.file) ?? [];
      uses.push(use);
      usesByFile.set(use.file, uses);
    }
  }

  const edits: FileEdit[] = [];
  for (const [file, uses] of usesByFile) {
    const text = readText(file);
    if (text === undefined) {
      throw new Error(`Could not read ${file}`);
    }
    const tree = treeOf(parseJsonDoc(text));
    if (!tree) {
      throw new Error(`Fix ${path.basename(file)} before removing QID references`);
    }
    const targets = new Set<Node>();
    for (const use of uses) {
      if (text.slice(use.ref.startOffset, use.ref.endOffset) !== use.ref.value) {
        throw new Error(
          `${file}:${use.start.line}:${use.start.column} changed before it could be updated`
        );
      }
      const value = findNodeAtLocation(tree, getLocation(text, use.ref.startOffset).path);
      if (!value) {
        throw new Error(`Could not locate QID reference in ${file}`);
      }
      switch (use.ref.spec.id) {
        case "assessment.question":
        case "assessment.alternative": {
          const object = value.parent?.type === "property" ? value.parent.parent : undefined;
          if (!object || object.type !== "object") {
            throw new Error(`Could not locate QID reference object in ${file}`);
          }
          targets.add(object);
          break;
        }
        case "question.template":
          targets.add(value);
          break;
        default:
          throw new Error(`Unsupported QID reference ${use.ref.spec.id} in ${file}`);
      }
    }

    // `alternatives` requires at least one entry. If all alternatives go,
    // remove the question block unless its own `id` can keep it valid.
    for (const target of [...targets]) {
      const array = target.parent;
      const property = array?.parent;
      const question = property?.parent;
      if (
        target.type === "object" &&
        array?.type === "array" &&
        property?.type === "property" &&
        question?.type === "object" &&
        property.children?.[0]?.value === "alternatives" &&
        (array.children ?? []).every((child) => targets.has(child))
      ) {
        (array.children ?? []).forEach((child) => targets.delete(child));
        targets.add(findNodeAtLocation(question, ["id"]) ? array : question);
      }
    }
    edits.push(...removeJsonValues(file, text, [...targets]));
  }
  return edits.sort(
    (a, b) => a.file.localeCompare(b.file) || a.startOffset - b.startOffset
  );
}
