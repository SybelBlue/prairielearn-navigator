import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Walks up from the directory containing `filePath` to the nearest directory
 * containing `infoCourse.json`. Returns that directory (the course id), or
 * null. `filePath` need not exist; to search from a directory `dir`, pass
 * `path.join(dir, "infoCourse.json")`.
 *
 * Pass the same `cache` across calls to look up each directory only once. It
 * maps each directory visited to its course root, or null for none.
 */
export function findCourseRoot(
  filePath: string,
  cache?: Map<string, string | null>
): string | null {
  const visited: string[] = [];
  let dir = path.dirname(path.resolve(filePath));
  let root: string | null | undefined;
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
