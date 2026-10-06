import * as fs from "node:fs";
import * as path from "node:path";
import { CourseId } from "../common";

/**
 * Walks up from `filePath` to the nearest directory containing
 * `infoCourse.json`. Returns that directory (the course id), or null.
 * Pass the same `cache` across calls to look up each directory only once.
 */
export function findCourseRoot(
  filePath: string,
  cache?: Map<string, CourseId | null>
): CourseId | null {
  const visited: string[] = [];
  let dir = path.dirname(path.resolve(filePath));
  let root: CourseId | null | undefined;
  while (root === undefined) {
    root = cache?.get(dir);
    if (root !== undefined) {
      break;
    }
    visited.push(dir);
    if (fs.existsSync(path.join(dir, "infoCourse.json"))) {
      root = dir;
    } else if (path.dirname(dir) === dir) {
      root = null;
    } else {
      dir = path.dirname(dir);
    }
  }
  visited.forEach((d) => cache?.set(d, root));
  return root;
}
