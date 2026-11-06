import * as path from "node:path";
import { findNodeAtLocation, Node } from "jsonc-parser";
import { configFileName } from "./config";
import { courseFiles, courseRelativePath, matchesGlob } from "./courseFiles";
import { courseNameProblem, NameKind, nounTitle } from "./courseNames";
import { offsetToPosition } from "./diagnostic";
import { edit, FileEdit } from "./fileEdits";
import { parseJsonDoc } from "./json";
import { removeJsonValues } from "./jsonEdits";
import { treeOf } from "./jsonTree";
import { ReferenceIndex } from "./referenceIndex";

/**
 * Edits to the items of a file using `kind` (a question's `tags`, an
 * assessment's `set`): the first `oldName` becomes `newName`, unless the file
 * already lists `newName`; every other `oldName` is removed.
 */
function useEdits(
  kind: NameKind,
  file: string,
  text: string,
  oldName: string,
  newName: string | undefined
): FileEdit[] {
  const tree = treeOf(parseJsonDoc(text));
  const items = tree ? kind.useItems(tree) : [];
  const isString = (node: Node, name: string) => node.type === "string" && node.value === name;
  const oldItems = items.filter((node) => isString(node, oldName));
  if (newName === undefined) {
    return removeJsonValues(file, text, oldItems);
  }
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

/** Edits renaming `ignoredDiagnostics` identifiers for `kind`'s rules. */
function suppressionEdits(
  kind: NameKind,
  file: string,
  text: string,
  oldName: string,
  newName: string | undefined
): { edits: FileEdit[]; useCount: number } {
  const tree = treeOf(parseJsonDoc(text));
  const array = tree && findNodeAtLocation(tree, ["ignoredDiagnostics"]);
  if (array?.type !== "array") {
    return { edits: [], useCount: 0 };
  }
  const matched = (array.children ?? []).filter((entry) => {
    const rule = findNodeAtLocation(entry, ["rule"])?.value;
    const identifier = findNodeAtLocation(entry, ["identifier"]);
    return typeof rule === "string" && kind.rules.has(rule) && identifier?.value === oldName;
  });
  if (newName === undefined) {
    return { edits: removeJsonValues(file, text, matched), useCount: matched.length };
  }
  return {
    edits: matched.map((entry) => {
      const identifier = findNodeAtLocation(entry, ["identifier"])!;
      return edit(
        file,
        text,
        identifier.offset,
        identifier.offset + identifier.length,
        JSON.stringify(newName)
      );
    }),
    useCount: matched.length,
  };
}

/**
 * Files that may use `name`: those the index knows use it, and any of
 * `extraFiles` that use names of this kind (unsaved edits the index has not
 * seen).
 */
function filesUsingName(kind: NameKind, index: ReferenceIndex, name: string, extraFiles: readonly string[]): Set<string> {
  return new Set([
    ...index.filesUsing(kind.collection).filter((file) => index.namesIn(file)?.[kind.collection].includes(name)),
    ...extraFiles.filter((file) => matchesGlob(courseRelativePath(index.courseRoot, file), kind.useFiles)),
  ]);
}

/** Where a name appears in a course file; positions are 1-based. */
export interface NameOccurrence {
  file: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
}

function occurrence(file: string, text: string, start: number, end: number): NameOccurrence {
  return { file, start: offsetToPosition(text, start), end: offsetToPosition(text, end) };
}

/**
 * Where a tag or assessment set infoCourse.json defines appears: its
 * definitions there, and every use naming it. Empty when infoCourse.json
 * does not define it. `readText` and `extraFiles` are as for
 * planCourseNameRename.
 */
export function findCourseNameReferences(
  kind: NameKind,
  index: ReferenceIndex,
  name: string,
  readText: (file: string) => string | undefined,
  extraFiles: readonly string[] = []
): { definitions: NameOccurrence[]; uses: NameOccurrence[] } {
  const infoCourse = path.join(index.courseRoot, courseFiles.course);
  const infoText = readText(infoCourse);
  const definitions = infoText === undefined
    ? []
    : kind.definitions(parseJsonDoc(infoText))
      .filter((d) => d.name === name)
      .map((d) => occurrence(infoCourse, infoText, d.nameStart, d.nameEnd));
  if (definitions.length === 0) {
    return { definitions, uses: [] };
  }
  const uses: NameOccurrence[] = [];
  for (const file of [...filesUsingName(kind, index, name, extraFiles)].sort()) {
    const text = readText(file);
    const tree = text === undefined ? undefined : treeOf(parseJsonDoc(text));
    if (text === undefined || !tree) {
      continue;
    }
    for (const node of kind.useItems(tree)) {
      if (node.type === "string" && node.value === name) {
        uses.push(occurrence(file, text, node.offset, node.offset + node.length));
      }
    }
  }
  return { definitions, uses };
}

/**
 * Plans renaming a tag or assessment set infoCourse.json defines: its
 * definition, every file using it, and suppressions naming it. Throws, with
 * a message for the user, when the rename is not allowed.
 *
 * `readText` gives a file's current text (an unsaved editor's, in VS Code).
 * `extraFiles` are files to check besides those the index knows use the
 * name, for edits the index has not caught up with.
 */
export function planCourseNameRename(
  kind: NameKind,
  index: ReferenceIndex,
  oldName: string,
  newName: string,
  readText: (file: string) => string | undefined,
  extraFiles: readonly string[] = []
): FileEdit[] {
  const Noun = nounTitle(kind);
  if (newName === oldName) {
    throw new Error(`${Noun} "${oldName}" cannot be renamed to itself`);
  }
  const courseRoot = index.courseRoot;
  const infoCourse = path.join(courseRoot, courseFiles.course);
  const infoText = readText(infoCourse);
  if (infoText === undefined) {
    throw new Error(`Could not read ${courseFiles.course}`);
  }
  const defined = kind.definitions(parseJsonDoc(infoText));
  if (!defined.some((d) => d.name === oldName)) {
    throw new Error(`${Noun} "${oldName}" is not defined in ${courseFiles.course}`);
  }
  const problem = courseNameProblem(kind, newName, defined.map((d) => d.name));
  if (problem) {
    throw new Error(problem);
  }

  const edits = defined
    .filter((d) => d.name === oldName)
    .map((d) => edit(infoCourse, infoText, d.nameStart, d.nameEnd, JSON.stringify(newName)));

  for (const file of filesUsingName(kind, index, oldName, extraFiles)) {
    const text = readText(file);
    if (text !== undefined) {
      edits.push(...useEdits(kind, file, text, oldName, newName));
    }
  }

  const config = path.join(courseRoot, configFileName);
  const configText = readText(config);
  if (configText !== undefined) {
    edits.push(...suppressionEdits(kind, config, configText, oldName, newName).edits);
  }

  return edits.sort(
    (a, b) => a.file.localeCompare(b.file) || a.startOffset - b.startOffset
  );
}

export interface CourseNameRemoval {
  /** Removes every matching definition from infoCourse.json. */
  primaryEdits: FileEdit[];
  /** Removes or replaces uses, and removes suppressions naming the old name. */
  referenceEdits: FileEdit[];
  useCount: number;
  referenceCount: number;
}

/**
 * Plans removing a tag or assessment-set definition. With `replacement`, uses
 * are rewritten to it; without one, array-valued uses (tags) are removed.
 * Suppressions for the removed name are deleted rather than transferred.
 */
export function planCourseNameRemoval(
  kind: NameKind,
  index: ReferenceIndex,
  oldName: string,
  replacement: string | undefined,
  readText: (file: string) => string | undefined,
  extraFiles: readonly string[] = []
): CourseNameRemoval {
  const Noun = nounTitle(kind);
  const infoCourse = path.join(index.courseRoot, courseFiles.course);
  const infoText = readText(infoCourse);
  if (infoText === undefined) {
    throw new Error(`Could not read ${courseFiles.course}`);
  }
  const tree = treeOf(parseJsonDoc(infoText));
  const defined = kind.definitions(parseJsonDoc(infoText));
  const matches = defined.filter((definition) => definition.name === oldName);
  if (matches.length === 0) {
    throw new Error(`${Noun} "${oldName}" is not defined in ${courseFiles.course}`);
  }
  if (replacement !== undefined) {
    if (replacement === oldName) {
      throw new Error(`${Noun} "${oldName}" cannot replace itself`);
    }
    if (!defined.some((definition) => definition.name === replacement)) {
      throw new Error(`${Noun} "${replacement}" is not defined in ${courseFiles.course}`);
    }
  }
  const collection = tree && findNodeAtLocation(tree, [kind.collection]);
  const entries = collection?.type === "array" ? collection.children ?? [] : [];
  const primaryEdits = removeJsonValues(
    infoCourse,
    infoText,
    matches.flatMap((definition) => entries[definition.index] ?? [])
  );

  const referenceEdits: FileEdit[] = [];
  let useCount = 0;
  for (const file of filesUsingName(kind, index, oldName, extraFiles)) {
    const text = readText(file);
    if (text === undefined) {
      continue;
    }
    const fileTree = treeOf(parseJsonDoc(text));
    const uses = fileTree
      ? kind.useItems(fileTree).filter((node) => node.type === "string" && node.value === oldName)
      : [];
    useCount += uses.length;
    referenceEdits.push(...useEdits(kind, file, text, oldName, replacement));
  }
  const config = path.join(index.courseRoot, configFileName);
  const configText = readText(config);
  let suppressionCount = 0;
  if (configText !== undefined) {
    const suppressions = suppressionEdits(kind, config, configText, oldName, undefined);
    referenceEdits.push(...suppressions.edits);
    suppressionCount = suppressions.useCount;
  }
  referenceEdits.sort(
    (a, b) => a.file.localeCompare(b.file) || a.startOffset - b.startOffset
  );
  return { primaryEdits, referenceEdits, useCount, referenceCount: useCount + suppressionCount };
}
