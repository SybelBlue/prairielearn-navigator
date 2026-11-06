import * as fs from "node:fs";
import * as path from "node:path";
import { findNodeAtLocation } from "jsonc-parser";
import { configFileName } from "./config";
import { courseFiles, courseRelativePath, isWithinDir, matchesGlob, relativeIdProblem } from "./courseFiles";
import { parentsEmptiedBy } from "./emptyDirs";
import { edit, FileEdit } from "./fileEdits";
import { parseJsonDoc } from "./json";
import { treeOf } from "./jsonTree";
import { folderOutside, placementProblem } from "./placement";
import { ReferenceIndex } from "./referenceIndex";

/** An assessment in a course, named by the directories that locate it. */
export interface CourseAssessment {
  /** Absolute path of its infoAssessment.json. */
  file: string;
  /** Its course instance: a posix path under courseInstances/. */
  instance: string;
  /** Its directory: a posix path under the instance's assessments/. */
  assessment: string;
}

/**
 * `<instance>/<assessment>`. Not always unique: `2026/assessments/Fa/hw` and
 * `2026/Fa/assessments/hw` are both `2026/Fa/hw`.
 */
export function assessmentId({ instance, assessment }: CourseAssessment): string {
  return `${instance}/${assessment}`;
}

/** Every assessment the index read, in no particular order. */
export function courseAssessments(index: ReferenceIndex): CourseAssessment[] {
  return index.files().flatMap((file) => {
    const relPath = courseRelativePath(index.courseRoot, file);
    if (!matchesGlob(relPath, courseFiles.assessment)) {
      return [];
    }
    // courseInstances/<instance>/assessments/<assessment>/infoAssessment.json
    const parts = relPath.split("/").slice(1, -1);
    const split = parts.indexOf("assessments");
    return [{
      file,
      instance: parts.slice(0, split).join("/"),
      assessment: parts.slice(split + 1).join("/"),
    }];
  });
}

/**
 * Every course instance, as a posix path under courseInstances/, sorted.
 * PrairieLearn stops at the first infoCourseInstance.json on its way down, so
 * one nested in another isn't an instance.
 */
export function courseInstances(courseRoot: string): string[] {
  const prefix = "courseInstances/";
  const all = fs
    .globSync(courseFiles.courseInstance, { cwd: courseRoot })
    .map((rel) => path.posix.dirname(rel.split(path.sep).join("/")))
    .filter((dir) => dir.startsWith(prefix))
    .map((dir) => dir.slice(prefix.length));
  return all.filter((instance) => !all.some((other) => instance.startsWith(`${other}/`))).sort();
}

/** Where an assessment that doesn't exist yet goes. */
export interface AssessmentTarget {
  instance: string;
  /** Absolute. The instance's assessments/ directory. */
  assessmentsDir: string;
  /** Absolute. */
  dir: string;
}

function assessmentsDirOf(courseRoot: string, instance: string): string {
  return path.join(courseRoot, "courseInstances", ...instance.split("/"), "assessments");
}

/** Finds the instance a new assessment's id starts with, or returns what's wrong with the id. */
export function assessmentTarget(courseRoot: string, id: string): AssessmentTarget | string {
  const instances = courseInstances(courseRoot);
  if (instances.includes(id)) {
    return `"${id}" is a course instance; name an assessment in it, as "${id}/hw1"`;
  }
  const instance = instances.find((candidate) => id.startsWith(`${candidate}/`));
  if (!instance) {
    return `Assessment "${id}" must start with a course instance: ${instances.join(", ") || "none found"}`;
  }
  const assessmentsDir = assessmentsDirOf(courseRoot, instance);
  return {
    instance,
    assessmentsDir,
    dir: path.join(assessmentsDir, ...id.slice(instance.length + 1).split("/")),
  };
}

/** The start of the id of an assessment added at `dir`, an absolute directory. */
export function assessmentPrefixFor(courseRoot: string, dir: string): string {
  const instances = courseInstances(courseRoot);
  const root = (instance: string) => path.join(courseRoot, "courseInstances", ...instance.split("/"));
  const instance = instances.find((candidate) => isWithinDir(root(candidate), dir)) ??
    (instances.length === 1 ? instances[0] : undefined);
  if (!instance) {
    return "";
  }
  const assessmentsDir = assessmentsDirOf(courseRoot, instance);
  if (!isWithinDir(assessmentsDir, dir) || dir === assessmentsDir) {
    return `${instance}/`;
  }
  const base = folderOutside(dir, assessmentsDir, path.basename(courseFiles.assessment));
  const rel = courseRelativePath(assessmentsDir, base);
  return rel ? `${instance}/${rel}/` : `${instance}/`;
}

/** One more than the highest number `set` uses in `instance`. "2R" counts as 2. */
export function nextAssessmentNumber(
  index: ReferenceIndex,
  readText: (file: string) => string | undefined,
  instance: string,
  set: string
): string {
  const used = courseAssessments(index)
    .filter((a) => a.instance === instance && index.namesIn(a.file)?.assessmentSets[0] === set)
    .map((a) => {
      const number = (parseJsonDoc(readText(a.file) ?? "").value as { number?: unknown } | undefined)?.number;
      return typeof number === "string" ? Number.parseInt(number, 10) : Number.NaN;
    })
    .filter((number) => Number.isFinite(number));
  return String(Math.max(0, ...used) + 1);
}

/** Moving an assessment's directory, with the edits that keep up with it. */
export interface AssessmentRename {
  /** Absolute. */
  oldDir: string;
  /** Absolute. Does not exist yet. */
  newDir: string;
  /** Absolute. The instance's assessments/ directory, which holds both. */
  assessmentsDir: string;
  /** Absolute. Directories the move leaves empty, innermost first. */
  emptiedDirs: string[];
  edits: FileEdit[];
}

/** Whether `dir` is strictly inside `parent`. */
function isInside(parent: string, dir: string): boolean {
  const rel = path.relative(parent, dir);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Edits to `ignoredDiagnostics` entries for files in `oldDir`. */
function suppressionEdits(
  courseRoot: string,
  config: string,
  text: string,
  oldDir: string,
  newDir: string
): FileEdit[] {
  const tree = treeOf(parseJsonDoc(text));
  const array = tree && findNodeAtLocation(tree, ["ignoredDiagnostics"]);
  if (array?.type !== "array") {
    return [];
  }
  return (array.children ?? []).flatMap((entry): FileEdit[] => {
    const node = findNodeAtLocation(entry, ["file"]);
    if (typeof node?.value !== "string") {
      return [];
    }
    const file = path.resolve(courseRoot, node.value);
    if (!isInside(oldDir, file)) {
      return [];
    }
    const moved = courseRelativePath(courseRoot, path.join(newDir, path.relative(oldDir, file)));
    return [edit(config, text, node.offset, node.offset + node.length, JSON.stringify(moved))];
  });
}

/**
 * Plans renaming an assessment within its course instance: its directory, and
 * suppressions naming files in it. Nothing else in a course names an
 * assessment's directory. Ids are as `assessmentId` gives them. Throws, with
 * a message for the user, when the rename is not allowed.
 *
 * `readText` gives a file's current text.
 */
export function planAssessmentRename(
  index: ReferenceIndex,
  oldId: string,
  newId: string,
  readText: (file: string) => string | undefined
): AssessmentRename {
  const problem = relativeIdProblem("Assessment", newId);
  if (problem) {
    throw new Error(problem);
  }
  if (newId === oldId) {
    throw new Error(`Assessment "${oldId}" cannot be renamed to itself`);
  }

  const { courseRoot } = index;
  const assessments = courseAssessments(index);
  const matches = assessments.filter((a) => assessmentId(a) === oldId);
  if (matches.length === 0) {
    throw new Error(`Assessment "${oldId}" is not defined`);
  }
  if (matches.length > 1) {
    const files = matches.map((a) => courseRelativePath(courseRoot, a.file)).sort();
    throw new Error(`Assessment "${oldId}" is ambiguous: ${files.join(", ")}`);
  }

  const { file, instance } = matches[0];
  if (!newId.startsWith(`${instance}/`)) {
    throw new Error(`Assessment "${newId}" must stay in course instance "${instance}"`);
  }
  const oldDir = path.dirname(file);
  const assessmentsDir = path.join(
    courseRoot,
    "courseInstances",
    ...instance.split("/"),
    "assessments"
  );
  const newDir = path.join(assessmentsDir, ...newId.slice(instance.length + 1).split("/"));
  const placement = placementProblem(
    "Assessment",
    newId,
    newDir,
    assessmentsDir,
    path.basename(courseFiles.assessment),
    (dir) => `${instance}/${courseRelativePath(assessmentsDir, dir)}`
  );
  if (placement) {
    throw new Error(placement);
  }

  const config = path.join(courseRoot, configFileName);
  const configText = readText(config);
  const edits = configText === undefined
    ? []
    : suppressionEdits(courseRoot, config, configText, oldDir, newDir);
  const emptiedDirs = parentsEmptiedBy(oldDir, assessmentsDir).filter(
    (dir) => !isInside(dir, newDir)
  );
  return { oldDir, newDir, assessmentsDir, emptiedDirs, edits };
}
