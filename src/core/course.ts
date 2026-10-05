import * as fs from "node:fs";
import * as path from "node:path";
import { CourseId } from "../common";

/**
 * Walks up from `filePath` to the nearest directory containing
 * `infoCourse.json`. Returns that directory (the course id), or null.
 */
export function findCourseRoot(filePath: string): CourseId | null {
  let dir = path.dirname(path.resolve(filePath));
  while (true) {
    if (fs.existsSync(path.join(dir, "infoCourse.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
