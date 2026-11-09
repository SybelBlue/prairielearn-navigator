import * as path from "node:path";
import { planAssessmentRemoval, assessmentId, courseAssessments } from "./assessments";
import { configFileName } from "./config";
import { planCourseNameRemoval } from "./courseNameRenames";
import { assessmentSetKind, NameKind, tagKind } from "./courseNames";
import { courseFiles, courseRelativePath, isWithinDir, matchesGlob } from "./courseFiles";
import { FileEdit } from "./fileEdits.js";
import { parseJsonDoc } from "./json";
import { planQidReferenceRemovals, qidReferenceUseCount } from "./qidRenames";
import { ReferenceIndex } from "./referenceIndex.js";
import { planRemoveFileSuppressions } from "./suppressionEdits";

export interface RemoveContext {
  index: ReferenceIndex;
  /** A file's current text (an unsaved editor's, in VS Code). */
  readText: (file: string) => string | undefined;
  /** Open dirty files the index may not have read yet. */
  extraFiles?: readonly string[];
}

export interface RemoveOptions {
  updateReferences: boolean;
  /** Used only by assessment-set removal. */
  replacement?: string;
  /** Files under these directories are being removed too and need no edits. */
  deletedRoots?: readonly string[];
}

export interface CourseRemoval {
  noun: string;
  id: string;
  /** Edits that perform the removal itself, such as deleting a definition. */
  primaryEdits: FileEdit[];
  /** Optional edits to uses and suppressions. */
  referenceEdits: FileEdit[];
  /** Logical references represented by `referenceEdits`. */
  referenceCount: number;
  /** A resource backed by a directory instead of primary text edits. */
  directory?: {
    path: string;
    /** Parent namespace that must not be removed. */
    root: string;
  };
}

export interface RemoveNoun {
  /** "question", for messages. */
  noun: string;
  argument: string;
  description: string;
  examples: readonly string[];
  targets(ctx: RemoveContext): string[];
  /** The target containing an Explorer/editor directory, when identifiable. */
  targetAt?(ctx: RemoveContext, dir: string): string | undefined;
  plan(ctx: RemoveContext, id: string, options: RemoveOptions): CourseRemoval;
}

function questionTargets(index: ReferenceIndex): { id: string; dir: string }[] {
  const root = path.join(index.courseRoot, "questions");
  return index.files().flatMap((file) =>
    matchesGlob(courseRelativePath(index.courseRoot, file), courseFiles.question)
      ? [{
          id: courseRelativePath(root, path.dirname(file)),
          dir: path.dirname(file),
        }]
      : []
  ).sort((a, b) => a.id.localeCompare(b.id));
}

function containingTarget(
  targets: readonly { id: string; dir: string }[],
  candidate: string
): string | undefined {
  return targets
    .filter((target) => isWithinDir(target.dir, candidate))
    .sort((a, b) => b.dir.length - a.dir.length)[0]?.id;
}

function nameTargets(kind: NameKind, ctx: RemoveContext): string[] {
  const file = path.join(ctx.index.courseRoot, courseFiles.course);
  const text = ctx.readText(file);
  return text === undefined
    ? []
    : [...new Set(kind.definitions(parseJsonDoc(text)).map((definition) => definition.name))].sort();
}

/** Removes config suppressions whose file lies in one of `removedDirs`. */
export function removedFileSuppressionPlan(
  ctx: RemoveContext,
  removedDirs: readonly string[]
): { edits: FileEdit[]; useCount: number } {
  const file = path.join(ctx.index.courseRoot, configFileName);
  const text = ctx.readText(file);
  return text === undefined
    ? { edits: [], useCount: 0 }
    : planRemoveFileSuppressions(ctx.index.courseRoot, file, text, removedDirs);
}

const questionNoun: RemoveNoun = {
  noun: "question",
  argument: "qid",
  description: "Remove a question directory and, unless disabled, its semantic references.",
  examples: ["qid remove unit1/quadratic", "qid remove --write unit1/quadratic"],
  targets: (ctx) => questionTargets(ctx.index).map((target) => target.id),
  targetAt: (ctx, dir) => containingTarget(questionTargets(ctx.index), dir),
  plan(ctx, qid, options) {
    const target = questionTargets(ctx.index).find((question) => question.id === qid);
    if (!target) {
      throw new Error(`Question "${qid}" is not defined`);
    }
    const deletedRoots = [...(options.deletedRoots ?? []), target.dir];
    const suppressions = options.updateReferences
      ? removedFileSuppressionPlan(ctx, [target.dir])
      : { edits: [], useCount: 0 };
    const referenceEdits = options.updateReferences
      ? [
          ...planQidReferenceRemovals(ctx.index, [qid], ctx.readText, deletedRoots),
          ...suppressions.edits,
        ]
      : [];
    return {
      noun: this.noun,
      id: qid,
      primaryEdits: [],
      referenceEdits,
      referenceCount: options.updateReferences
        ? qidReferenceUseCount(ctx.index, [qid], deletedRoots) + suppressions.useCount
        : 0,
      directory: { path: target.dir, root: path.join(ctx.index.courseRoot, "questions") },
    };
  },
};

function nameNoun(kind: NameKind): RemoveNoun {
  return {
    noun: kind.noun,
    argument: kind.noun.replace(" ", "-"),
    description: `Remove a ${kind.noun} defined in ${courseFiles.course} and, unless disabled, its references.`,
    examples: [`${kind.noun.replace(" ", "-")} remove old`],
    targets: (ctx) => nameTargets(kind, ctx),
    plan(ctx, name, options) {
      const planned = planCourseNameRemoval(
        kind,
        ctx.index,
        name,
        options.replacement,
        ctx.readText,
        ctx.extraFiles
      );
      if (
        options.updateReferences &&
        kind.collection === "assessmentSets" &&
        planned.useCount > 0 &&
        options.replacement === undefined
      ) {
        throw new Error(
          `Assessment set "${name}" is used by ${planned.useCount} ` +
          `${planned.useCount === 1 ? "assessment" : "assessments"}; provide --replacement`
        );
      }
      return {
        noun: this.noun,
        id: name,
        primaryEdits: planned.primaryEdits,
        referenceEdits: options.updateReferences ? planned.referenceEdits : [],
        referenceCount: options.updateReferences ? planned.referenceCount : 0,
      };
    },
  };
}

function assessmentTargets(index: ReferenceIndex): { id: string; dir: string }[] {
  return courseAssessments(index)
    .map((assessment) => ({ id: assessmentId(assessment), dir: path.dirname(assessment.file) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const assessmentNoun: RemoveNoun = {
  noun: "assessment",
  argument: "assessment",
  description: "Remove an assessment directory and, unless disabled, suppressions for its files.",
  examples: ["assessment remove Fa26/hw1", "assessment remove --write Fa26/hw1"],
  targets: (ctx) => assessmentTargets(ctx.index).map((target) => target.id),
  targetAt: (ctx, dir) => containingTarget(assessmentTargets(ctx.index), dir),
  plan(ctx, id, options) {
    const planned = planAssessmentRemoval(ctx.index, id, ctx.readText);
    return {
      noun: this.noun,
      id,
      primaryEdits: [],
      referenceEdits: options.updateReferences ? planned.referenceEdits : [],
      referenceCount: options.updateReferences ? planned.referenceCount : 0,
      directory: { path: planned.dir, root: planned.assessmentsDir },
    };
  },
};

/** Everything removable by the CLI and extension noun commands. */
export const removeNouns = {
  qid: questionNoun,
  tag: nameNoun(tagKind),
  "assessment-set": nameNoun(assessmentSetKind),
  assessment: assessmentNoun,
} as const satisfies Record<string, RemoveNoun>;
