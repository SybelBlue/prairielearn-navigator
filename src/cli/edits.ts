import * as fs from "node:fs";
import * as path from "node:path";
import { findCourseRoot } from "../core/course";
import { FileChange, FileEdit } from "../core/fileEdits";
import { CliRuntime } from "./runtime";

/** The course containing `value` (a course or a path inside one), relative to `cwd`. */
function resolveCourseRoot(value: string, cwd: string): string | null {
  const resolved = path.resolve(cwd, value);
  const stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat) {
    return null;
  }
  return findCourseRoot(stat.isDirectory() ? path.join(resolved, "_") : resolved);
}

/** The course at `value`, or null after telling the user why there isn't one. */
export function openCourse(value: string, runtime: CliRuntime): string | null {
  try {
    const courseRoot = resolveCourseRoot(value, runtime.cwd);
    if (!courseRoot) {
      runtime.stderr(`No PrairieLearn course found for ${path.resolve(runtime.cwd, value)}`);
    }
    return courseRoot;
  } catch (error) {
    runtime.stderr(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** A file's text, or undefined if it can't be read. */
export function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
}

export function displayEdit(edit: FileEdit, cwd: string): string {
  const file = path.relative(cwd, edit.file) || edit.file;
  return `${file}:${edit.start.line}:${edit.start.column} ${JSON.stringify(edit.expected)} -> ${JSON.stringify(edit.replacement)}`;
}

/** Writes every change, restoring the files already written if one fails. */
export function writeChanges(changes: readonly FileChange[]): void {
  const written: FileChange[] = [];
  try {
    for (const change of changes) {
      fs.writeFileSync(change.file, change.updated);
      written.push(change);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const change of written.reverse()) {
      try {
        fs.writeFileSync(change.file, change.original);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; failed to roll back ${rollbackErrors.length} file(s)`
      );
    }
    throw error;
  }
}

/** "1 reference" or "2 references". */
export function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
