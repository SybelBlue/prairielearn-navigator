import * as path from "node:path";

/** Directories a reference can be relative to. */
export type BaseName =
  | "fileDir" // the directory of the file holding the reference
  | "clientFilesQuestion"
  | "clientFilesCourse"
  | "serverFilesCourse"
  | "courseExtensions"
  | "questions";

export interface RefContext {
  courseRoot: string;
  /** Directory containing the file being read. */
  fileDir: string;
}

export function baseDir(base: BaseName, ctx: RefContext): string {
  switch (base) {
    case "fileDir":
      return ctx.fileDir;
    case "clientFilesQuestion":
      return path.join(ctx.fileDir, "clientFilesQuestion");
    case "clientFilesCourse":
      return path.join(ctx.courseRoot, "clientFilesCourse");
    case "serverFilesCourse":
      return path.join(ctx.courseRoot, "serverFilesCourse");
    case "courseExtensions":
      return path.join(ctx.courseRoot, "elementExtensions");
    case "questions":
      return path.join(ctx.courseRoot, "questions");
  }
}

/**
 * `base/value`, or null if that escapes `base`. Naming `base` itself counts
 * as escaping unless `allowBase` (a directory may be the base; a file not).
 */
export function inside(base: string, value: string, allowBase = false): string | null {
  const target = path.resolve(base, value);
  const rel = path.relative(base, target);
  if (rel === "") {
    return allowBase ? target : null;
  }
  return rel.startsWith("..") || path.isAbsolute(rel) ? null : target;
}
