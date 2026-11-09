import * as path from "node:path";
import picomatch from "picomatch";

/** Globs for each kind of PrairieLearn JSON file, relative to the course root. */
export const courseFiles = {
  course: "infoCourse.json",
  courseInstance: "courseInstances/**/infoCourseInstance.json",
  assessment: "courseInstances/**/assessments/**/infoAssessment.json",
  question: "questions/**/info.json",
  element: "elements/*/info.json",
  elementExtension: "elementExtensions/*/*/info.json",
} as const;

export const questionHtml = "questions/**/question.html";

const matchers = new Map<string, picomatch.Matcher>();

/** Matches a posix path relative to the course root against a glob. */
export function matchesGlob(relPath: string, glob: string): boolean {
  let m = matchers.get(glob);
  if (!m) {
    m = picomatch(glob, { dot: true });
    matchers.set(glob, m);
  }
  return m(relPath);
}

/** Whether `file` is `dir` or anywhere inside it. Unlike startsWith, `/a/bc` is not in `/a/b`. */
export function isWithinDir(dir: string, file: string): boolean {
  return file === dir || file.startsWith(dir + path.sep);
}

/** Returns a problem with an id, or undefined when it is a safe relative path. */
export function relativeIdProblem(noun: string, id: string): string | undefined {
  if (id.length === 0) {
    return `${noun}s must not be empty`;
  }
  if (
    id.includes("\\") ||
    path.posix.isAbsolute(id) ||
    /^[A-Za-z]:/.test(id)
  ) {
    return `${noun} "${id}" must be a relative path using forward slashes`;
  }
  if (id.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    return `${noun} "${id}" must not contain empty, ".", or ".." path segments`;
  }
  return undefined;
}

/** `filePath` relative to `courseRoot`, with forward slashes. */
export function courseRelativePath(courseRoot: string, filePath: string): string {
  return path.relative(courseRoot, filePath).split(path.sep).join("/");
}
