import * as vscode from "vscode";

export type ReferenceUpdateMode = "prompt" | "always" | "never";
export type ReferenceUpdateOperation = "rename" | "remove";

/** Reference-update policy for one resource and file operation. */
export function referenceUpdateMode(
  operation: ReferenceUpdateOperation,
  uri: vscode.Uri
): ReferenceUpdateMode {
  const key = operation === "rename"
    ? "updateReferencesOnRename"
    : "updateReferencesOnRemove";
  return vscode.workspace
    .getConfiguration("prairielearn-navigator", uri)
    .get<ReferenceUpdateMode>(key, "prompt");
}

