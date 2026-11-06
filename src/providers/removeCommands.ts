import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { courseFiles } from "../core/courseFiles";
import { removeEmptyParents } from "../core/emptyDirs";
import {
  CourseRemoval,
  RemoveContext,
  RemoveNoun,
  removeNouns,
} from "../core/removals";
import { CourseCache, ReferenceIndexCache } from "../filewatchers";
import { addFileEdits, currentText } from "./fileEdits";
import { referenceUpdateMode, ReferenceUpdateMode } from "./referenceUpdates";

const commandDeletes = new Set<string>();

/** Native delete participation skips deletes already planned by our command. */
export function isCommandDeletion(file: string): boolean {
  return commandDeletes.has(file);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function startingPoint(target: vscode.Uri | undefined): { probe?: vscode.Uri; dir?: string } {
  if (!target) {
    const active = vscode.window.activeTextEditor?.document.uri;
    return { probe: active, dir: active && path.dirname(active.fsPath) };
  }
  return fs.statSync(target.fsPath, { throwIfNoEntry: false })?.isDirectory()
    ? { probe: vscode.Uri.joinPath(target, "_"), dir: target.fsPath }
    : { probe: target, dir: path.dirname(target.fsPath) };
}

async function chooseCourse(courses: readonly string[]): Promise<string | undefined> {
  return courses.length > 1
    ? vscode.window.showQuickPick([...courses], { title: "Choose a Course" })
    : courses[0];
}

const updateReferences: vscode.MessageItem = { title: "Update References" };
const dontUpdate: vscode.MessageItem = { title: "Don't Update", isCloseAffordance: true };

async function confirmReferenceUpdates(noun: RemoveNoun, id: string, count: number): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    `Update ${count} additional ${count === 1 ? "reference" : "references"} while removing ${noun.noun} "${id}"?`,
    { modal: true },
    updateReferences,
    dontUpdate
  );
  return choice === updateReferences;
}

async function applyRemoval(removal: CourseRemoval): Promise<boolean> {
  const workspaceEdit = new vscode.WorkspaceEdit();
  const edits = [...removal.primaryEdits, ...removal.referenceEdits];
  addFileEdits(workspaceEdit, edits);
  const documents = await Promise.all(
    [...new Set(edits.map((edit) => edit.file))].map((file) =>
      vscode.workspace.openTextDocument(vscode.Uri.file(file))
    )
  );
  const dirty = new Set(documents.filter((document) => document.isDirty));
  if (removal.directory) {
    commandDeletes.add(removal.directory.path);
    workspaceEdit.deleteFile(vscode.Uri.file(removal.directory.path), {
      recursive: true,
      ignoreIfNotExists: false,
    });
  }
  try {
    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (applied) {
      await Promise.all(
        documents.filter((document) => !dirty.has(document)).map((document) => document.save())
      );
      const unsaved = documents.find((document) => dirty.has(document));
      if (unsaved) {
        await vscode.window.showTextDocument(unsaved);
      }
    }
    if (applied && removal.directory) {
      removeEmptyParents(removal.directory.path, removal.directory.root);
    }
    return applied;
  } finally {
    if (removal.directory) {
      commandDeletes.delete(removal.directory.path);
    }
  }
}

export interface RemoveCommandOptions {
  mode?(uri: vscode.Uri): ReferenceUpdateMode;
  pickTarget?(targets: readonly string[], seed: string | undefined): Thenable<string | undefined>;
  pickReplacement?(targets: readonly string[]): Thenable<string | undefined>;
  confirmReferences?(noun: RemoveNoun, id: string, count: number): Thenable<boolean>;
  confirmRemoval?(removal: CourseRemoval): Thenable<boolean>;
}

export interface RemoveCommandTarget {
  courseRoot: string;
  id: string;
}

/** One VS Code command removing a noun selected from the current course. */
export function removeCommand(
  noun: RemoveNoun,
  courseCache: Pick<CourseCache, "getCourseIdFor" | "getCourseIds">,
  references: Pick<ReferenceIndexCache, "whenIndexed">,
  options: RemoveCommandOptions = {}
) {
  return async (target?: vscode.Uri | string | RemoveCommandTarget): Promise<boolean> => {
    try {
      const direct = target && typeof target === "object" && "courseRoot" in target
        ? target
        : undefined;
      const resource = target instanceof vscode.Uri ? target : undefined;
      const { probe, dir } = startingPoint(resource);
      const courseRoot = direct?.courseRoot || (probe && courseCache.getCourseIdFor(probe)) ||
        await chooseCourse(courseCache.getCourseIds());
      if (!courseRoot) {
        void vscode.window.showErrorMessage("PrairieLearn Navigator: no course found.");
        return false;
      }
      const infoCourse = vscode.Uri.file(path.join(courseRoot, courseFiles.course));
      const index = await references.whenIndexed(infoCourse);
      if (!index) {
        throw new Error(`Could not index the course at ${courseRoot}`);
      }
      const extraFiles = vscode.workspace.textDocuments
        .filter((document) => document.isDirty && document.uri.fsPath.startsWith(courseRoot + path.sep))
        .map((document) => document.uri.fsPath);
      const ctx: RemoveContext = { index, readText: currentText, extraFiles };
      const targets = noun.targets(ctx);
      const seed = direct?.id ?? (
        typeof target === "string"
          ? target
          : noun.targetAt?.(ctx, dir ?? courseRoot)
      );
      const id = options.pickTarget
        ? await options.pickTarget(targets, seed)
        : seed && targets.includes(seed)
          ? seed
          : await vscode.window.showQuickPick(targets, {
              title: `Remove ${noun.noun[0].toUpperCase()}${noun.noun.slice(1)}`,
              placeHolder: `Choose a ${noun.noun} to remove`,
            });
      if (!id) {
        return false;
      }

      const mode = options.mode?.(infoCourse) ?? referenceUpdateMode("remove", infoCourse);
      let shouldUpdate = mode === "always";
      let replacement: string | undefined;
      const usedSet = noun === removeNouns["assessment-set"] &&
        index.filesUsing("assessmentSets").filter(
          (file) => index.namesIn(file)?.assessmentSets.includes(id)
        ).length;

      let probePlan: CourseRemoval | undefined;
      if (!usedSet) {
        probePlan = noun.plan(ctx, id, { updateReferences: true });
      }
      const impact = usedSet || probePlan?.referenceEdits.length || 0;
      if (mode === "prompt" && impact > 0) {
        shouldUpdate = await (
          options.confirmReferences?.(noun, id, impact) ??
          confirmReferenceUpdates(noun, id, impact)
        );
      }

      if (shouldUpdate && usedSet) {
        const replacements = removeNouns["assessment-set"].targets(ctx).filter((name) => name !== id);
        replacement = options.pickReplacement
          ? await options.pickReplacement(replacements)
          : await vscode.window.showQuickPick(replacements, {
              title: `Replace Assessment Set "${id}"`,
              placeHolder: "Choose the defined assessment set its assessments should use",
            });
        if (!replacement) {
          return false;
        }
      }

      const removal = shouldUpdate
        ? noun.plan(ctx, id, { updateReferences: true, replacement })
        : noun.plan(ctx, id, { updateReferences: false });
      const confirmed = options.confirmRemoval
        ? await options.confirmRemoval(removal)
        : await vscode.window.showWarningMessage(
            `Remove ${removal.noun} "${removal.id}"?`,
            { modal: true, detail: removal.directory ? "Its entire directory will be deleted." : undefined },
            "Remove"
          ) === "Remove";
      return confirmed ? applyRemoval(removal) : false;
    } catch (error) {
      void vscode.window.showErrorMessage(`PrairieLearn Navigator: ${errorMessage(error)}.`);
      return false;
    }
  };
}

/** Every remove command, by contributed command name. */
export function removeCommands(
  courseCache: Pick<CourseCache, "getCourseIdFor" | "getCourseIds">,
  references: Pick<ReferenceIndexCache, "whenIndexed">
) {
  const command = (noun: RemoveNoun) => removeCommand(noun, courseCache, references);
  return {
    removeQuestion: command(removeNouns.qid),
    removeTag: command(removeNouns.tag),
    removeAssessmentSet: command(removeNouns["assessment-set"]),
    removeAssessment: command(removeNouns.assessment),
  };
}

