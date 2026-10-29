import * as fs from "node:fs";
import * as path from "node:path";

/** A directory under questions/ that PrairieLearn will fail to load. */
export interface QuestionDirWithoutInfo {
  /** Absolute. */
  dir: string;
  /** The file the diagnostic is shown on: question.html, else the first file. */
  anchor: string;
}

/**
 * Directories under `<courseRoot>/questions` with files but no info.json and
 * no question anywhere below them. PrairieLearn walks questions/ the same way
 * (skipping hidden entries) and records each as "Missing JSON file".
 */
export function questionDirsWithoutInfo(courseRoot: string): QuestionDirWithoutInfo[] {
  const out: QuestionDirWithoutInfo[] = [];
  // Whether any question lies at or below `dir`
  const walk = (dir: string): boolean => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith("."))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    let hasQuestion = false;
    for (const e of entries) {
      if (!e.isDirectory()) {
        continue;
      }
      const sub = path.join(dir, e.name);
      if (fs.existsSync(path.join(sub, "info.json")) || walk(sub)) {
        hasQuestion = true;
      } else {
        const files = fs
          .readdirSync(sub, { withFileTypes: true })
          .filter((f) => !f.name.startsWith(".") && !f.isDirectory())
          .map((f) => f.name)
          .sort();
        if (files.length > 0) {
          const anchor = files.includes("question.html") ? "question.html" : files[0];
          out.push({ dir: sub, anchor: path.join(sub, anchor) });
        }
      }
    }
    return hasQuestion;
  };
  const questions = path.join(courseRoot, "questions");
  if (fs.statSync(questions, { throwIfNoEntry: false })?.isDirectory()) {
    walk(questions);
  }
  return out.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
}
