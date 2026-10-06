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

/** `filePath` relative to `courseRoot`, with forward slashes. */
export function courseRelativePath(courseRoot: string, filePath: string): string {
  return path.relative(courseRoot, filePath).split(path.sep).join("/");
}
