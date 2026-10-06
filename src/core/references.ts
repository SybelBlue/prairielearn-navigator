import * as fs from "node:fs";
import * as path from "node:path";
import { JSONPath, Node } from "jsonc-parser";
import { courseFiles, matchesGlob, questionHtml } from "./courseFiles";
import { findElements, HtmlElement } from "./html";
import { JsonDoc, parseJsonDoc } from "./json";
import { IsoDate, matchesRange, VersionRange } from "./plVersion";
import { questionFilePathsFromId } from "./questionPaths";

/**
 * Every JSON field and element attribute that names another file in the
 * course. These tables drive both "does the file exist" rules and editor
 * jump-to-file.
 */

export type RefKind =
  | "clientFilesCourse"
  | "clientFilesQuestion"
  | "elementFile"
  | "question"
  | "plFigure";

/** Matches a property key or array index; "*" matches any key or index. */
type PathSegment = string | RegExp;
type PathPattern = readonly PathSegment[];

interface RefContext {
  courseRoot: string;
  /** Directory containing the file being read. */
  fileDir: string;
}

/** The file references are read from; `doc` is only read for JSON files. */
interface SourceFile {
  text: string;
  readonly doc: JsonDoc;
}

/** A SourceFile that parses its JSON on first use. */
export function sourceOf(text: string): SourceFile {
  let doc: JsonDoc | undefined;
  return {
    text,
    get doc() {
      return (doc ??= parseJsonDoc(text));
    },
  };
}

/** Resolves a string value to an absolute path, or null if invalid. */
type Resolve = (value: string, ctx: RefContext) => string | null;

type RefSpec = readonly [
  range: VersionRange,
  files: string,
  path: PathPattern,
  kind: RefKind,
  resolve: Resolve,
];

export interface FileRef {
  kind: RefKind;
  /** Where a JSON reference was found. */
  jsonPath?: JSONPath;
  value: string;
  /** Offsets of the string value, excluding quotes. */
  startOffset: number;
  endOffset: number;
  /** Absolute path the value points to; null if it escapes its directory. */
  target: string | null;
  /** Why the reference is invalid regardless of the file system. */
  problem?: string;
}

/** Collects the references made by one element tag. */
type HtmlRefs = (element: HtmlElement, ctx: RefContext) => FileRef[];

type HtmlRefSpec = readonly [
  range: VersionRange,
  files: string,
  tagName: string,
  refs: HtmlRefs,
];

/** `base/value`, or null if that escapes `base`. */
function inside(base: string, value: string): string | null {
  const target = path.resolve(base, value);
  const rel = path.relative(base, target);
  return rel === "" || rel.startsWith("..") || path.isAbsolute(rel)
    ? null
    : target;
}

const inClientFilesCourse: Resolve = (v, c) =>
  inside(path.join(c.courseRoot, "clientFilesCourse"), v);
const inClientFilesQuestion: Resolve = (v, c) =>
  inside(path.join(c.fileDir, "clientFilesQuestion"), v);
const inFileDir: Resolve = (v, c) => inside(c.fileDir, v);
const toQuestion: Resolve = (v, c) => {
  const paths = questionFilePathsFromId({ courseId: c.courseRoot, localId: v });
  if (!inside(path.join(c.courseRoot, "questions"), v)) {
    return null;
  }
  return fs.existsSync(paths.questionHtml) ? paths.questionHtml : paths.infoJson;
};

const clientFilesCourseDeps = /^clientFilesCourse(Styles|Scripts)$/;
const elementDeps = /^element(Styles|Scripts)$/;
const extensionDeps = /^extension(Styles|Scripts)$/;

const fileReferences: readonly RefSpec[] = [
  // Questions
  ["*", courseFiles.question, ["dependencies", clientFilesCourseDeps, "*"], "clientFilesCourse", inClientFilesCourse],
  ["*", courseFiles.question, ["dependencies", /^clientFilesQuestion(Styles|Scripts)$/, "*"], "clientFilesQuestion", inClientFilesQuestion],

  // Course elements
  ["*", courseFiles.element, ["controller"], "elementFile", inFileDir],
  ["*", courseFiles.element, ["dependencies", clientFilesCourseDeps, "*"], "clientFilesCourse", inClientFilesCourse],
  ["*", courseFiles.element, ["dependencies", elementDeps, "*"], "elementFile", inFileDir],
  ["*", courseFiles.element, ["dynamicDependencies", "clientFilesCourseScripts", "*"], "clientFilesCourse", inClientFilesCourse],
  ["*", courseFiles.element, ["dynamicDependencies", "elementScripts", "*"], "elementFile", inFileDir],

  // Element extensions
  ["*", courseFiles.elementExtension, ["controller"], "elementFile", inFileDir],
  ["*", courseFiles.elementExtension, ["dependencies", clientFilesCourseDeps, "*"], "clientFilesCourse", inClientFilesCourse],
  ["*", courseFiles.elementExtension, ["dependencies", extensionDeps, "*"], "elementFile", inFileDir],
  ["*", courseFiles.elementExtension, ["dynamicDependencies", "clientFilesCourseScripts", "*"], "clientFilesCourse", inClientFilesCourse],
  ["*", courseFiles.elementExtension, ["dynamicDependencies", "extensionScripts", "*"], "elementFile", inFileDir],

  // Assessments
  ["*", courseFiles.assessment, ["zones", "*", "questions", "*", "id"], "question", toQuestion],
  ["*", courseFiles.assessment, ["zones", "*", "questions", "*", "alternatives", "*", "id"], "question", toQuestion],
];

/** Mustache is rendered before elements are, so these values are unknowable. */
const isTemplated = (value: string) => value.includes("{{");

/** pl-figure: static figures in clientFilesQuestion (default) or clientFilesCourse. */
const plFigureRefs: HtmlRefs = (element, ctx) => {
  const fileName = element.attributes.get("file-name");
  const type = element.attributes.get("type")?.value ?? "static";
  const directory = element.attributes.get("directory");
  const dirName = directory?.value ?? "clientFilesQuestion";
  if (
    !fileName ||
    [fileName.value, type, dirName].some(isTemplated) ||
    type.trim().toLowerCase() !== "static"
  ) {
    return [];
  }

  const ref = { kind: "plFigure" as const, value: fileName.value, startOffset: fileName.startOffset, endOffset: fileName.endOffset };
  const base =
    dirName === "clientFilesQuestion" ? path.join(ctx.fileDir, "clientFilesQuestion")
    : dirName === "clientFilesCourse" ? path.join(ctx.courseRoot, "clientFilesCourse")
    : undefined;
  if (!base) {
    return [{
      ...ref,
      value: dirName,
      startOffset: directory?.startOffset ?? ref.startOffset,
      endOffset: directory?.endOffset ?? ref.endOffset,
      target: null,
      problem: `invalid pl-figure directory "${dirName}": must be "clientFilesQuestion" or "clientFilesCourse"`,
    }];
  }
  const target = inside(base, fileName.value);
  return [{
    ...ref,
    target,
    problem: target ? undefined : `"${fileName.value}" must be a path inside ${dirName}/`,
  }];
};

const htmlReferences: readonly HtmlRefSpec[] = [
  ["*", questionHtml, "pl-figure", plFigureRefs],
];

function segmentMatches(segment: PathSegment, key: string | number): boolean {
  if (segment === "*") {
    return true;
  }
  if (segment instanceof RegExp) {
    return typeof key === "string" && segment.test(key);
  }
  return segment === String(key);
}

/** String nodes reached by following `pattern` from `node`. */
function matchPattern(
  node: Node,
  pattern: PathPattern,
  jsonPath: JSONPath,
  out: { node: Node; jsonPath: JSONPath }[]
) {
  if (jsonPath.length === pattern.length) {
    if (node.type === "string") {
      out.push({ node, jsonPath });
    }
    return;
  }
  const segment = pattern[jsonPath.length];
  if (node.type === "object") {
    for (const prop of node.children ?? []) {
      const [key, value] = prop.children ?? [];
      if (key && value && segmentMatches(segment, key.value)) {
        matchPattern(value, pattern, [...jsonPath, key.value], out);
      }
    }
  } else if (node.type === "array") {
    (node.children ?? []).forEach((child, i) => {
      if (segmentMatches(segment, i)) {
        matchPattern(child, pattern, [...jsonPath, i], out);
      }
    });
  }
}

/** All file references in a course file, in document order. */
export function findFileRefs(
  source: SourceFile,
  relPath: string,
  plDate: IsoDate,
  ctx: RefContext,
  kinds?: readonly RefKind[]
): FileRef[] {
  const applies = (range: VersionRange, files: string, kind?: RefKind) =>
    (!kinds || !kind || kinds.includes(kind)) &&
    matchesGlob(relPath, files) &&
    matchesRange(range, plDate);

  const refs: FileRef[] = [];
  for (const [range, files, tagName, collect] of htmlReferences) {
    if (applies(range, files)) {
      for (const element of findElements(source.text, tagName)) {
        refs.push(...collect(element, ctx).filter((r) => !kinds || kinds.includes(r.kind)));
      }
    }
  }

  const tree = relPath.endsWith(".json") ? source.doc.tree : undefined;
  for (const [range, files, pattern, kind, resolve] of tree ? fileReferences : []) {
    if (!applies(range, files, kind)) {
      continue;
    }
    const matches: { node: Node; jsonPath: JSONPath }[] = [];
    matchPattern(tree!, pattern, [], matches);
    for (const { node, jsonPath } of matches) {
      const value = node.value as string;
      refs.push({
        kind,
        jsonPath,
        value,
        startOffset: node.offset + 1,
        endOffset: node.offset + node.length - 1,
        target: resolve(value, ctx),
      });
    }
  }
  return refs.sort((a, b) => a.startOffset - b.startOffset);
}

/** The file reference whose string value contains `offset`, if any. */
export function fileRefAt(
  source: SourceFile,
  relPath: string,
  plDate: IsoDate,
  ctx: RefContext,
  offset: number
): FileRef | undefined {
  return findFileRefs(source, relPath, plDate, ctx).find(
    (r) => r.startOffset - 1 <= offset && offset <= r.endOffset + 1
  );
}
