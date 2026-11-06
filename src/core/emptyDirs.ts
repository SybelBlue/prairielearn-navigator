import * as fs from "node:fs";
import * as path from "node:path";

/** `dir`'s parents strictly inside `root`, innermost first. */
function parentsWithin(dir: string, root: string): string[] {
  const out: string[] = [];
  for (
    let parent = path.dirname(dir);
    parent.startsWith(root + path.sep);
    parent = path.dirname(parent)
  ) {
    out.push(parent);
  }
  return out;
}

/** The parents of `dir`, below `root`, that removing `dir` would leave empty. */
export function parentsEmptiedBy(dir: string, root: string): string[] {
  const out: string[] = [];
  let child = dir;
  for (const parent of parentsWithin(dir, root)) {
    const entries = fs.readdirSync(parent);
    if (entries.length !== 1 || entries[0] !== path.basename(child)) {
      break;
    }
    out.push(parent);
    child = parent;
  }
  return out;
}

/**
 * Removes the empty parents of `dir` below `root`, innermost first, up to the
 * first that can't be removed. A hidden file such as .DS_Store keeps a
 * directory. Never throws: a leftover directory shouldn't fail what emptied it.
 */
export function removeEmptyParents(dir: string, root: string): void {
  for (const parent of parentsWithin(dir, root)) {
    try {
      fs.rmdirSync(parent);
    } catch {
      return;
    }
  }
}
