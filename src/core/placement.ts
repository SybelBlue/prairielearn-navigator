import * as fs from "node:fs";
import * as path from "node:path";
import { parentsWithin } from "./emptyDirs";

/**
 * `dir`, or if it's at or inside a directory holding `marker` (a question or
 * an assessment), the folder holding the outermost of those.
 */
export function folderOutside(dir: string, root: string, marker: string): string {
  const marked = [dir, ...parentsWithin(dir, root)].filter((d) => fs.existsSync(path.join(d, marker)));
  return marked.length > 0 ? path.dirname(marked[marked.length - 1]) : dir;
}

/**
 * A problem with creating `dir`, the directory of a question or assessment
 * under `root`, or undefined. PrairieLearn stops at the first `marker` file on
 * its way down, so it would never find anything inside another. Checks the
 * disk, which is newer than any index.
 */
export function placementProblem(
  noun: string,
  id: string,
  dir: string,
  root: string,
  marker: string,
  idOf: (dir: string) => string
): string | undefined {
  if (fs.existsSync(dir)) {
    return `${noun} "${id}" already exists`;
  }
  const container = parentsWithin(dir, root).find((parent) => fs.existsSync(path.join(parent, marker)));
  return container ? `${noun} "${id}" must not be inside "${idOf(container)}"` : undefined;
}
