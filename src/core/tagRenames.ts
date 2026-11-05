import * as path from "node:path";
import { findNodeAtLocation, Node } from "jsonc-parser";
import { configFileName } from "./config";
import { courseFiles, courseRelativePath, matchesGlob } from "./courseFiles";
import { offsetToPosition } from "./diagnostic";
import { FileEdit } from "./fileEdits";
import { parseJsonDoc } from "./json";
import { ReferenceIndex } from "./referenceIndex";
import { courseTags } from "./tags";

/** Rules whose suppressions identify a tag by its name. */
const tagRules = new Set(["unused-tag", "undefined-tag"]);

function edit(file: string, text: string, start: number, end: number, replacement: string): FileEdit {
  return {
    file,
    startOffset: start,
    endOffset: end,
    start: offsetToPosition(text, start),
    end: offsetToPosition(text, end),
    expected: text.slice(start, end),
    replacement,
  };
}

/**
 * Edits to a question's `tags` array: the first `oldName` becomes `newName`,
 * unless the question already lists `newName`; every other `oldName` is removed.
 */
function questionEdits(file: string, text: string, oldName: string, newName: string): FileEdit[] {
  const tree = parseJsonDoc(text).tree;
  const array = tree && findNodeAtLocation(tree, ["tags"]);
  if (array?.type !== "array") {
    return [];
  }
  const items = array.children ?? [];
  const isString = (node: Node, name: string) => node.type === "string" && node.value === name;
  let keep = !items.some((node) => isString(node, newName));
  const out: FileEdit[] = [];
  const removed = new Set<number>();
  items.forEach((node, i) => {
    if (!isString(node, oldName)) {
      return;
    }
    if (keep) {
      keep = false;
      out.push(edit(file, text, node.offset, node.offset + node.length, JSON.stringify(newName)));
    } else {
      removed.add(i);
    }
  });
  // Remove each run of entries with its separators: up to the next kept entry,
  // or, for a run at the end, from the end of the entry before it
  const end = (node: Node) => node.offset + node.length;
  for (let a = 0; a < items.length; a++) {
    if (!removed.has(a)) {
      continue;
    }
    let b = a;
    while (removed.has(b + 1)) {
      b++;
    }
    const [start, stop] = b + 1 < items.length
      ? [items[a].offset, items[b + 1].offset]
      : [end(items[a - 1]), end(items[b])];
    out.push(edit(file, text, start, stop, ""));
    a = b;
  }
  return out;
}

/** Edits renaming `ignoredDiagnostics` identifiers for tag rules. */
function suppressionEdits(file: string, text: string, oldName: string, newName: string): FileEdit[] {
  const tree = parseJsonDoc(text).tree;
  const array = tree && findNodeAtLocation(tree, ["ignoredDiagnostics"]);
  if (array?.type !== "array") {
    return [];
  }
  return (array.children ?? []).flatMap((entry): FileEdit[] => {
    const rule = findNodeAtLocation(entry, ["rule"])?.value;
    const identifier = findNodeAtLocation(entry, ["identifier"]);
    return typeof rule === "string" && tagRules.has(rule) && identifier?.value === oldName
      ? [edit(file, text, identifier.offset, identifier.offset + identifier.length, JSON.stringify(newName))]
      : [];
  });
}

/**
 * Plans renaming a tag infoCourse.json defines: its definition, every
 * question using it, and suppressions naming it. Throws, with a message for
 * the user, when the rename is not allowed.
 *
 * `readText` gives a file's current text (an unsaved editor's, in VS Code).
 * `extraFiles` are questions to check besides those the index knows use the
 * tag, for edits the index has not caught up with.
 */
export function planTagRename(
  index: ReferenceIndex,
  oldName: string,
  newName: string,
  readText: (file: string) => string | undefined,
  extraFiles: readonly string[] = []
): FileEdit[] {
  if (newName.trim() === "") {
    throw new Error("Tag names must not be empty");
  }
  if (newName === oldName) {
    throw new Error(`Tag "${oldName}" cannot be renamed to itself`);
  }
  const courseRoot = index.courseRoot;
  const infoCourse = path.join(courseRoot, courseFiles.course);
  const infoText = readText(infoCourse);
  if (infoText === undefined) {
    throw new Error(`Could not read ${courseFiles.course}`);
  }
  const defined = courseTags(parseJsonDoc(infoText));
  if (!defined.some((tag) => tag.name === oldName)) {
    throw new Error(`Tag "${oldName}" is not defined in ${courseFiles.course}`);
  }
  if (defined.some((tag) => tag.name === newName)) {
    throw new Error(`Tag "${newName}" is already defined in ${courseFiles.course}`);
  }

  const edits = defined
    .filter((tag) => tag.name === oldName)
    .map((tag) => edit(infoCourse, infoText, tag.nameStart, tag.nameEnd, JSON.stringify(newName)));

  const questions = new Set([
    ...index.filesUsingTags().filter((file) => index.namesIn(file)?.tags.includes(oldName)),
    ...extraFiles.filter((file) => matchesGlob(courseRelativePath(courseRoot, file), courseFiles.question)),
  ]);
  for (const file of questions) {
    const text = readText(file);
    if (text !== undefined) {
      edits.push(...questionEdits(file, text, oldName, newName));
    }
  }

  const config = path.join(courseRoot, configFileName);
  const configText = readText(config);
  if (configText !== undefined) {
    edits.push(...suppressionEdits(config, configText, oldName, newName));
  }

  return edits.sort(
    (a, b) => a.file.localeCompare(b.file) || a.startOffset - b.startOffset
  );
}
