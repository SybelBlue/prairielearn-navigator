import * as fs from "node:fs";
import * as path from "node:path";
import { courseRelativePath } from "./courseFiles";
import { offsetToPosition } from "./diagnostic";
import { IsoDate } from "./plVersion";
import { FileRef, findFileRefs, holdsReferences, sourceOf } from "./references/extract";
import { refSpecs } from "./references/specs";

/** One place a course file references a target. */
export interface Use {
  /** The file holding the reference. */
  file: string;
  ref: FileRef;
  /** 1-based, like offsetToPosition. */
  start: { line: number; column: number };
  end: { line: number; column: number };
}

/**
 * Reverse index of every file reference in one course: which files
 * reference a given target. Updated one file at a time.
 */
export class ReferenceIndex {
  private usesByFile = new Map<string, Use[]>();
  private filesByTarget = new Map<string, Set<string>>();
  /** How many targets lie under each directory, to answer directory events quickly. */
  private targetsUnder = new Map<string, number>();

  constructor(
    readonly courseRoot: string,
    private plDate: IsoDate
  ) {}

  /** Whether `file` can hold references at all. */
  holdsReferences(file: string): boolean {
    return holdsReferences(courseRelativePath(this.courseRoot, file));
  }

  /** Re-reads the references in `file` from `text`. */
  update(file: string, text: string) {
    this.remove(file);
    const refs = findFileRefs(
      sourceOf(text),
      courseRelativePath(this.courseRoot, file),
      this.plDate,
      { courseRoot: this.courseRoot, fileDir: path.dirname(file) }
    );
    const uses = refs
      .filter((ref) => ref.target !== null)
      .map((ref) => ({
        file,
        ref,
        start: offsetToPosition(text, ref.startOffset),
        end: offsetToPosition(text, ref.endOffset),
      }));
    this.usesByFile.set(file, uses);
    for (const use of uses) {
      const target = use.ref.target!;
      let files = this.filesByTarget.get(target);
      if (!files) {
        this.filesByTarget.set(target, (files = new Set()));
        this.countUnder(target, 1);
      }
      files.add(file);
    }
  }

  remove(file: string) {
    for (const use of this.usesByFile.get(file) ?? []) {
      const files = this.filesByTarget.get(use.ref.target!);
      files?.delete(file);
      if (files?.size === 0) {
        this.filesByTarget.delete(use.ref.target!);
        this.countUnder(use.ref.target!, -1);
      }
    }
    this.usesByFile.delete(file);
  }

  /** Every file holding references. */
  files(): string[] {
    return [...this.usesByFile.keys()];
  }

  /** References made by `file`. */
  usesIn(file: string): Use[] {
    return this.usesByFile.get(file) ?? [];
  }

  /**
   * References to `target`. A reference to a directory (a question, or a
   * serverFilesCourse folder) also counts as a use of every file inside it.
   */
  usesOf(target: string): Use[] {
    const out: Use[] = [];
    for (let dir = target; ; dir = path.dirname(dir)) {
      for (const file of this.filesByTarget.get(dir) ?? []) {
        for (const use of this.usesIn(file)) {
          if (use.ref.target === dir && covers(use, dir, target)) {
            out.push(use);
          }
        }
      }
      if (dir === this.courseRoot || path.dirname(dir) === dir) {
        break;
      }
    }
    return out.sort((a, b) => a.file.localeCompare(b.file) || a.ref.startOffset - b.ref.startOffset);
  }

  private countUnder(target: string, delta: number) {
    for (let dir = path.dirname(target); ; dir = path.dirname(dir)) {
      const n = (this.targetsUnder.get(dir) ?? 0) + delta;
      if (n === 0) {
        this.targetsUnder.delete(dir);
      } else {
        this.targetsUnder.set(dir, n);
      }
      if (dir === this.courseRoot || path.dirname(dir) === dir) {
        break;
      }
    }
  }

  /**
   * Files whose references can be affected by `changed` (a created, edited,
   * or deleted path): references to it, to a directory containing it, or,
   * when it is a directory, to anything inside it.
   */
  filesAffectedBy(changed: string): string[] {
    const out = new Set<string>();
    const add = (target: string) => this.filesByTarget.get(target)?.forEach((f) => out.add(f));
    for (let dir = changed; ; dir = path.dirname(dir)) {
      add(dir);
      if (dir === this.courseRoot || path.dirname(dir) === dir) {
        break;
      }
    }
    if (this.targetsUnder.has(changed)) {
      for (const target of this.filesByTarget.keys()) {
        if (target.startsWith(changed + path.sep)) {
          add(target);
        }
      }
    }
    return [...out];
  }
}

function referenceFiles(courseRoot: string): string[] {
  const globs = [...new Set(refSpecs.map((s) => s.files))];
  return fs.globSync(globs, { cwd: courseRoot }).map((rel) => path.join(courseRoot, rel));
}

/**
 * Whether a use of `dir` counts as a use of `target` inside it: a file
 * reference only for itself, a question for its own top-level files
 * (info.json, question.html, server.py, ...), a directory for everything.
 */
function covers(use: Use, dir: string, target: string): boolean {
  switch (use.ref.spec.target) {
    case "file":
      return dir === target;
    case "question":
      return dir === target || path.dirname(target) === dir;
    case "fileOrDir":
      return true;
  }
}

/** Indexes every reference-holding file in a course from disk. */
export function indexCourse(courseRoot: string, plDate: IsoDate): ReferenceIndex {
  const index = new ReferenceIndex(courseRoot, plDate);
  for (const file of referenceFiles(courseRoot)) {
    index.update(file, fs.readFileSync(file, "utf-8"));
  }
  return index;
}

/**
 * Like indexCourse, but reads files asynchronously in batches, yielding
 * between them, so a large course does not block an editor.
 */
export async function indexCourseAsync(
  courseRoot: string,
  plDate: IsoDate,
  batchSize = 64
): Promise<ReferenceIndex> {
  const index = new ReferenceIndex(courseRoot, plDate);
  const files = referenceFiles(courseRoot); // a directory walk; reading is the slow part
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const texts = await Promise.all(
      batch.map((f) => fs.promises.readFile(f, "utf-8").catch(() => undefined))
    );
    batch.forEach((file, j) => {
      if (texts[j] !== undefined) {
        index.update(file, texts[j]);
      }
    });
  }
  return index;
}
