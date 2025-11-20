import * as vscode from "vscode";

export const commands = {
  async openFile(path: string, selection?: vscode.Range) {
    await vscode.window.showTextDocument(vscode.Uri.file(path), {
      selection,
    });
  },
  unknownId(questionId: string) {
    vscode.window.showInformationMessage(
      `question id "${questionId}" does not exist`
    );
  },
  async showOccurrences(occurrences: vscode.Location[]) {
    if (occurrences.length === 0) {
      vscode.window.showInformationMessage("No references found");
      return;
    }

    await vscode.commands.executeCommand(
      "editor.action.showReferences",
      occurrences[0].uri,
      occurrences[0].range.start,
      occurrences
    );
  },
};
