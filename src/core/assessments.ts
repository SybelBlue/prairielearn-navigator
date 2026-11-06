import * as fs from "node:fs";
import * as path from "node:path";
import { configFileName } from "./config";
import { courseFiles, courseRelativePath, isWithinDir, matchesGlob, relativeIdProblem } from "./courseFiles";
import { parentsEmptiedBy } from "./emptyDirs";
import { FileEdit } from "./fileEdits";
import { parseJsonDoc } from "./json";
import { folderOutside, placementProblem } from "./placement";
import { ReferenceIndex } from "./referenceIndex";
import { moveFileSuppressionEdits, removeFileSuppressionEdits } from "./suppressionEdits";

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

/** Finds exactly one assessment by the id printed by `assessment list`. */
function assessmentById(index: ReferenceIndex, id: string): CourseAssessment {
  const matches = courseAssessments(index).filter((assessment) => assessmentId(assessment) === id);
  if (matches.length === 0) {
    throw new Error(`Assessment "${id}" is not defined`);
  }
  if (matches.length > 1) {
    const files = matches.map((assessment) => courseRelativePath(index.courseRoot, assessment.file)).sort();
    throw new Error(`Assessment "${id}" is ambiguous: ${files.join(", ")}`);
  }
  return matches[0];
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
  const { file, instance } = assessmentById(index, oldId);
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
    : moveFileSuppressionEdits(courseRoot, config, configText, oldDir, newDir);
  const emptiedDirs = parentsEmptiedBy(oldDir, assessmentsDir).filter(
    (dir) => !isWithinDir(dir, newDir)
  );
  return { oldDir, newDir, assessmentsDir, emptiedDirs, edits };
}

export interface AssessmentRemoval {
  /** Absolute directory to remove. */
  dir: string;
  /** Absolute assessments/ directory that must remain. */
  assessmentsDir: string;
  referenceEdits: FileEdit[];
}

/** Plans removing an assessment directory and suppressions for files inside it. */
export function planAssessmentRemoval(
  index: ReferenceIndex,
  id: string,
  readText: (file: string) => string | undefined
): AssessmentRemoval {
  const { file, instance } = assessmentById(index, id);
  const dir = path.dirname(file);
  const assessmentsDir = assessmentsDirOf(index.courseRoot, instance);
  const config = path.join(index.courseRoot, configFileName);
  const configText = readText(config);
  const referenceEdits = configText === undefined
    ? []
    : removeFileSuppressionEdits(index.courseRoot, config, configText, [dir]);
  return { dir, assessmentsDir, referenceEdits };
}
