import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { courseRelativePath, isWithinDir } from "../core/courseFiles";
import { removeEmptyParents } from "../core/emptyDirs";
import { FileEdit } from "../core/fileEdits";
import { planQidReferenceRemovals, qidReferenceUseCount } from "../core/qidRenames";
import { RemoveContext, removedFileSuppressionPlan } from "../core/removals";
import { CourseCache, ReferenceIndexCache } from "../filewatchers";
import { addFileEdits, currentText } from "./fileEdits";
import { isCommandDeletion } from "./removeCommands";
import { referenceUpdateMode, ReferenceUpdateMode } from "./referenceUpdates";

interface RemovedResources {
  courseRoot: string;
  referenceUri: vscode.Uri;
  deletedRoots: string[];
  questionDirs: string[];
  assessmentDirs: string[];
  qids: string[];
  assessments: string[];
}

interface RemoveReferencePrompt {
  edits: readonly FileEdit[];
  referenceCount: number;
  qids: readonly string[];
  assessments: readonly string[];
}

export interface RemoveParticipantOptions {
  confirm?(prompt: RemoveReferencePrompt): Thenable<boolean>;
  warn?(message: string): void;
  mode?(uri: vscode.Uri): ReferenceUpdateMode;
}

const updateReferences: vscode.MessageItem = { title: "Update References" };
const dontUpdate: vscode.MessageItem = { title: "Don't Update", isCloseAffordance: true };

async function defaultConfirmation(prompt: RemoveReferencePrompt): Promise<boolean> {
  const resources = prompt.qids.length + prompt.assessments.length;
  const choice = await vscode.window.showInformationMessage(
    `Update ${prompt.referenceCount} additional ` +
      `${prompt.referenceCount === 1 ? "reference" : "references"} for ` +
      `${resources} removed ${resources === 1 ? "resource" : "resources"}?`,
    { modal: true },
    updateReferences,
    dontUpdate
  );
  return choice === updateReferences;
}

async function resourceDirectories(root: string, marker: string): Promise<string[]> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return [];
  }
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === marker)) {
      out.push(dir);
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith("."))
        .map((entry) => walk(path.join(dir, entry.name)))
    );
  };
  await walk(root);
  return out.sort();
}

async function removedResources(
  files: readonly vscode.Uri[],
  courseCache: Pick<CourseCache, "getCourseIdFor">
): Promise<RemovedResources[]> {
  const grouped = new Map<string, { referenceUri: vscode.Uri; roots: Set<string> }>();
  for (const uri of files) {
    if (uri.scheme !== "file" || isCommandDeletion(uri.fsPath)) {
      continue;
    }
    const courseRoot = courseCache.getCourseIdFor(uri);
    if (!courseRoot || !isWithinDir(courseRoot, uri.fsPath)) {
      continue;
    }
    const group = grouped.get(courseRoot) ?? { referenceUri: uri, roots: new Set<string>() };
    group.roots.add(uri.fsPath);
    grouped.set(courseRoot, group);
  }

  const result: RemovedResources[] = [];
  for (const [courseRoot, group] of grouped) {
    const questionsRoot = path.join(courseRoot, "questions");
    const questionDirs = new Set<string>();
    const assessmentDirs = new Set<string>();
    for (const root of group.roots) {
      const [questions, assessments] = await Promise.all([
        resourceDirectories(root, "info.json"),
        resourceDirectories(root, "infoAssessment.json"),
      ]);
      questions.filter((dir) => isWithinDir(questionsRoot, dir)).forEach((dir) => questionDirs.add(dir));
      assessments.filter((dir) => assessmentIdFromDir(courseRoot, dir) !== undefined)
        .forEach((dir) => assessmentDirs.add(dir));
    }
    result.push({
      courseRoot,
      referenceUri: group.referenceUri,
      deletedRoots: [...group.roots],
      questionDirs: [...questionDirs],
      assessmentDirs: [...assessmentDirs],
      qids: [...questionDirs].map((dir) => path.relative(questionsRoot, dir).split(path.sep).join("/")),
      assessments: [...assessmentDirs].flatMap((dir) => assessmentIdFromDir(courseRoot, dir) ?? []),
    });
  }
  return result.filter((group) => group.questionDirs.length + group.assessmentDirs.length > 0);
}

/** The CLI-style assessment id represented by a resource directory. */
function assessmentIdFromDir(courseRoot: string, dir: string): string | undefined {
  const parts = courseRelativePath(courseRoot, dir).split("/");
  const assessments = parts.indexOf("assessments", 1);
  if (parts[0] !== "courseInstances" || assessments < 2 || assessments === parts.length - 1) {
    return undefined;
  }
  return `${parts.slice(1, assessments).join("/")}/${parts.slice(assessments + 1).join("/")}`;
}

const cleanupAfterDelete = new Map<string, { dir: string; root: string }[]>();

/** Builds reference edits contributed to one native Explorer delete. */
export async function prepareRemoveWorkspaceEdit(
  files: readonly vscode.Uri[],
  token: vscode.CancellationToken,
  courseCache: Pick<CourseCache, "getCourseIdFor">,
  references: Pick<ReferenceIndexCache, "whenIndexed">,
  options: RemoveParticipantOptions = {}
): Promise<vscode.WorkspaceEdit> {
  const workspaceEdit = new vscode.WorkspaceEdit();
  try {
    const groups = await removedResources(files, courseCache);
    const automatic: FileEdit[] = [];
    const prompted: FileEdit[] = [];
    let promptReferenceCount = 0;
    const promptQids: string[] = [];
    const promptAssessments: string[] = [];
    for (const group of groups) {
      for (const deletedRoot of group.deletedRoots) {
        cleanupAfterDelete.set(deletedRoot, [
          ...group.questionDirs.map((dir) => ({ dir, root: path.join(group.courseRoot, "questions") })),
          ...group.assessmentDirs.flatMap((dir) => {
            const relative = path.relative(group.courseRoot, dir).split(path.sep);
            const assessments = relative.indexOf("assessments");
            return assessments < 0
              ? []
              : [{ dir, root: path.join(group.courseRoot, ...relative.slice(0, assessments + 1)) }];
          }),
        ]);
      }
      if (token.isCancellationRequested) {
        return workspaceEdit;
      }
      const mode = options.mode?.(group.referenceUri) ??
        referenceUpdateMode("remove", group.referenceUri);
      if (mode === "never") {
        continue;
      }
      const index = await references.whenIndexed(group.referenceUri);
      if (!index) {
        throw new Error(`could not index course ${group.courseRoot}`);
      }
      const ctx: RemoveContext = { index, readText: currentText };
      const suppressions = removedFileSuppressionPlan(
        ctx,
        [...group.questionDirs, ...group.assessmentDirs]
      );
      const edits = [
        ...planQidReferenceRemovals(index, group.qids, currentText, group.deletedRoots),
        ...suppressions.edits,
      ];
      const referenceCount = qidReferenceUseCount(index, group.qids, group.deletedRoots) +
        suppressions.useCount;
      if (mode === "always") {
        automatic.push(...edits);
      } else {
        prompted.push(...edits);
        promptReferenceCount += referenceCount;
        promptQids.push(...group.qids);
        promptAssessments.push(...group.assessments);
      }
    }
    if (token.isCancellationRequested) {
      return workspaceEdit;
    }
    let accepted = prompted;
    if (promptReferenceCount > 0) {
      const confirm = options.confirm ?? defaultConfirmation;
      if (!(await confirm({
        edits: prompted,
        referenceCount: promptReferenceCount,
        qids: promptQids,
        assessments: promptAssessments,
      }))) {
        accepted = [];
      }
    }
    addFileEdits(workspaceEdit, [...automatic, ...accepted]);
  } catch (error) {
    if (!token.isCancellationRequested) {
      const message =
        "PrairieLearn Navigator could not update references for this removal: " +
        `${error instanceof Error ? error.message : String(error)}. ` +
        "The removal will continue without reference changes.";
      (options.warn ?? ((text) => void vscode.window.showWarningMessage(text)))(message);
    }
  }
  return workspaceEdit;
}

/** Registers automatic reference cleanup for native Explorer deletion. */
export function registerRemoveParticipant(
  courseCache: CourseCache,
  references: ReferenceIndexCache
): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.workspace.onWillDeleteFiles((event) => {
      event.waitUntil(
        prepareRemoveWorkspaceEdit(event.files, event.token, courseCache, references)
      );
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      for (const file of event.files) {
        for (const cleanup of cleanupAfterDelete.get(file.fsPath) ?? []) {
          removeEmptyParents(cleanup.dir, cleanup.root);
        }
        cleanupAfterDelete.delete(file.fsPath);
      }
    })
  );
}
