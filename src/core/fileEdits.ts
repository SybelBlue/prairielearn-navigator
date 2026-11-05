import * as fs from "node:fs";

/** One replacement in a course file, located by offsets and by 1-based position. */
export interface FileEdit {
  file: string;
  startOffset: number;
  endOffset: number;
  start: { line: number; column: number };
  end: { line: number; column: number };
  /** The text the range must still hold for the edit to apply. */
  expected: string;
  replacement: string;
}

export interface FileChange {
  file: string;
  original: string;
  updated: string;
}

/**
 * Reads and validates every affected file, then returns their complete updated
 * contents without writing anything.
 */
export function prepareFileChanges(edits: readonly FileEdit[]): FileChange[] {
  const byFile = new Map<string, FileEdit[]>();
  for (const edit of edits) {
    const fileEdits = byFile.get(edit.file) ?? [];
    fileEdits.push(edit);
    byFile.set(edit.file, fileEdits);
  }

  const changes: FileChange[] = [];
  for (const file of [...byFile.keys()].sort()) {
    const original = fs.readFileSync(file, "utf-8");
    const fileEdits = byFile.get(file)!.sort(
      (a, b) => b.startOffset - a.startOffset || b.endOffset - a.endOffset
    );
    let nextStart = original.length;
    for (const edit of fileEdits) {
      if (edit.endOffset > nextStart) {
        throw new Error(
          `Overlapping edits in ${file}:${edit.start.line}:${edit.start.column}`
        );
      }
      if (
        edit.startOffset < 0 ||
        edit.endOffset < edit.startOffset ||
        original.slice(edit.startOffset, edit.endOffset) !== edit.expected
      ) {
        throw new Error(
          `${file}:${edit.start.line}:${edit.start.column} changed before it could be updated`
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
