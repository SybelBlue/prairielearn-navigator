import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  planQidReferenceRenames,
  QidRename,
  QidReferenceEdit,
} from "../core/qidRenames";
import { CourseCache, ReferenceIndexCache } from "../filewatchers";

const updateReferences = "Update References";
const dontUpdate = "Don't Update";

export interface QidRenameCoursePlan {
  courseRoot: string;
  referenceUri: vscode.Uri;
  renames: QidRename[];
}

interface QidRenamePrompt {
  edits: readonly QidReferenceEdit[];
  renames: readonly QidRename[];
}

export interface QidRenameParticipantOptions {
  confirm?(prompt: QidRenamePrompt): Thenable<boolean>;
  warn?(message: string): void;
}

function relativeInside(root: string, candidate: string): string | undefined {
  const relative = path.relative(root, candidate);
  return relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
    ? relative
    : undefined;
}

async function questionDirectories(root: string): Promise<string[]> {
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
    if (entries.some((entry) => entry.isFile() && entry.name === "info.json")) {
      out.push(dir);
    }
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            !entry.name.startsWith(".")
        )
        .map((entry) => walk(path.join(dir, entry.name)))
    );
  };
  await walk(root);
  return out.sort();
}

/** Finds explicit QID mappings implied by VS Code folder rename operations. */
export async function qidRenamesForFileMoves(
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
  courseCache: Pick<CourseCache, "getCourseIdFor">
): Promise<QidRenameCoursePlan[]> {
  const groups = new Map<
    string,
    { referenceUri: vscode.Uri; byOldQid: Map<string, string> }
  >();
  const ordered = [...files].sort(
    (a, b) => b.oldUri.fsPath.length - a.oldUri.fsPath.length
  );

  for (const { oldUri, newUri } of ordered) {
    if (oldUri.scheme !== "file" || newUri.scheme !== "file") {
      continue;
    }
    const courseRoot = courseCache.getCourseIdFor(oldUri);
    if (!courseRoot) {
      continue;
    }
    const questionsRoot = path.join(courseRoot, "questions");
    const oldRelative = relativeInside(questionsRoot, oldUri.fsPath);
    const newRelative = relativeInside(questionsRoot, newUri.fsPath);
    if (
      !oldRelative ||
      !newRelative ||
      oldRelative.split(path.sep).some((segment) => segment.startsWith(".")) ||
      newRelative.split(path.sep).some((segment) => segment.startsWith("."))
    ) {
      continue;
    }

    const dirs = await questionDirectories(oldUri.fsPath);
    if (dirs.length === 0) {
      continue;
    }
    let group = groups.get(courseRoot);
    if (!group) {
      group = { referenceUri: oldUri, byOldQid: new Map() };
      groups.set(courseRoot, group);
    }
    for (const oldDir of dirs) {
      const suffix = path.relative(oldUri.fsPath, oldDir);
      const newDir = path.join(newUri.fsPath, suffix);
      const oldQid = path.relative(questionsRoot, oldDir).split(path.sep).join("/");
      const newQid = path.relative(questionsRoot, newDir).split(path.sep).join("/");
      if (oldQid !== newQid && !group.byOldQid.has(oldQid)) {
        group.byOldQid.set(oldQid, newQid);
      }
    }
  }

  return [...groups.entries()]
    .map(([courseRoot, group]) => ({
      courseRoot,
      referenceUri: group.referenceUri,
      renames: [...group.byOldQid].map(([oldQid, newQid]) => ({
        oldQid,
        newQid,
      })),
    }))
    .filter((group) => group.renames.length > 0)
    .sort((a, b) => a.courseRoot.localeCompare(b.courseRoot));
}

async function defaultConfirmation(prompt: QidRenamePrompt): Promise<boolean> {
  const count = prompt.edits.length;
  const message =
    prompt.renames.length === 1
      ? `Update ${count} ${count === 1 ? "reference" : "references"} from QID "${prompt.renames[0].oldQid}" to "${prompt.renames[0].newQid}"?`
      : `Update ${count} ${count === 1 ? "reference" : "references"} for ${prompt.renames.length} renamed QIDs?`;
  const shown = prompt.renames.slice(0, 10);
  const remaining = prompt.renames.length - shown.length;
  const detail =
    prompt.renames.length > 1
      ? shown.map(({ oldQid, newQid }) => `${oldQid} → ${newQid}`).join("\n") +
        (remaining > 0 ? `\n…and ${remaining} more` : "")
      : undefined;
  const choice = await vscode.window.showInformationMessage(
    message,
    { modal: true, detail },
    updateReferences,
    dontUpdate
  );
  return choice === updateReferences;
}

/** Builds the text edits contributed to one VS Code folder rename operation. */
export async function prepareQidRenameWorkspaceEdit(
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
  token: vscode.CancellationToken,
  courseCache: Pick<CourseCache, "getCourseIdFor">,
  references: Pick<ReferenceIndexCache, "whenIndexed">,
  options: QidRenameParticipantOptions = {}
): Promise<vscode.WorkspaceEdit> {
  const workspaceEdit = new vscode.WorkspaceEdit();
  try {
    const groups = await qidRenamesForFileMoves(files, courseCache);
    if (token.isCancellationRequested || groups.length === 0) {
      return workspaceEdit;
    }

    const edits: QidReferenceEdit[] = [];
    const referencedRenames: QidRename[] = [];
    for (const group of groups) {
      const index = await references.whenIndexed(group.referenceUri);
      if (!index) {
        throw new Error(`could not index course ${group.courseRoot}`);
      }
      const groupEdits = planQidReferenceRenames(index, group.renames);
      edits.push(...groupEdits);
      for (const rename of group.renames) {
        if (
          groupEdits.some(
            (edit) =>
              edit.oldQid === rename.oldQid && edit.newQid === rename.newQid
          )
        ) {
          referencedRenames.push(rename);
        }
      }
    }
    if (token.isCancellationRequested || edits.length === 0) {
      return workspaceEdit;
    }

    edits.sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.startOffset - b.startOffset
    );
    const confirm = options.confirm ?? defaultConfirmation;
    if (!(await confirm({ edits, renames: referencedRenames }))) {
      return workspaceEdit;
    }
    if (token.isCancellationRequested) {
      return workspaceEdit;
    }

    for (const edit of edits) {
      workspaceEdit.replace(
        vscode.Uri.file(edit.file),
        new vscode.Range(
          edit.start.line - 1,
          edit.start.column - 1,
          edit.end.line - 1,
          edit.end.column - 1
        ),
        edit.replacement
      );
    }
    return workspaceEdit;
  } catch (error) {
    if (!token.isCancellationRequested) {
      const message =
        "PrairieLearn Navigator could not update QID references for this move: " +
        `${error instanceof Error ? error.message : String(error)}. ` +
        "The folder move will continue without reference changes.";
      (options.warn ?? ((text) => void vscode.window.showWarningMessage(text)))(
        message
      );
    }
    return workspaceEdit;
  }
}

/** Registers the VS Code-only automatic question-folder move participant. */
export function registerQidRenameParticipant(
  courseCache: CourseCache,
  references: ReferenceIndexCache
): vscode.Disposable {
  return vscode.workspace.onWillRenameFiles((event) => {
    event.waitUntil(
      prepareQidRenameWorkspaceEdit(
        event.files,
        event.token,
        courseCache,
        references
      )
    );
  });
}
