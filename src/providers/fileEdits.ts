import * as fs from "node:fs";
import * as vscode from "vscode";
import { FileEdit } from "../core/fileEdits";
import { jsonValueRange, JsonFocus } from "../core/jsonEdits";

/** A file's text, from its editor if open, else from disk. */
export function currentText(file: string): string | undefined {
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === file);
  if (open) {
    return open.getText();
  }
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
}

/** The range of a span with core's 1-based positions. */
export function fileRange({ start, end }: Pick<FileEdit, "start" | "end">): vscode.Range {
  return new vscode.Range(start.line - 1, start.column - 1, end.line - 1, end.column - 1);
}

export function addFileEdits(workspaceEdit: vscode.WorkspaceEdit, edits: readonly FileEdit[]): void {
  for (const edit of edits) {
    workspaceEdit.replace(vscode.Uri.file(edit.file), fileRange(edit), edit.replacement);
  }
}

/**
 * Applies an edit to `document`, saving it unless it already had unsaved
 * changes, which are the user's to save and so stay in view.
 */
export async function applyToDocument(
  workspaceEdit: vscode.WorkspaceEdit,
  document: vscode.TextDocument
): Promise<boolean> {
  const wasDirty = document.isDirty;
  const applied = await vscode.workspace.applyEdit(workspaceEdit);
  if (applied && !wasDirty) {
    await document.save();
  } else if (applied) {
    await vscode.window.showTextDocument(document);
  }
  return applied;
}

/** Shows a file with the focused value selected. */
export async function revealFocus({ file, path }: JsonFocus): Promise<void> {
  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document);
  const range = jsonValueRange(document.getText(), path);
  if (range) {
    editor.selection = new vscode.Selection(document.positionAt(range.start), document.positionAt(range.end));
    editor.revealRange(editor.selection);
  }
}
