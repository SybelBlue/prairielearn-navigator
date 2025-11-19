// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";

class PrairieLearnAssessmentDefinitionProvider
  implements vscode.DefinitionProvider
{
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition> {
    // Get the range of the quoted string at cursor
    const range = document.getWordRangeAtPosition(position, /"([^"]+)"/);
    if (!range) {
      return null;
    }

    const questionId = this.getConfirmedQuestionId(document, position, range);
    if (!questionId) {
      return null;
    }

    console.log("prairielearn -- questionId:" + questionId);

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return null;
    }

    const questionPath = path.join(
      workspaceFolder.uri.fsPath,
      "questions",
      questionId,
      "info.json"
    );

    return new vscode.Location(
      vscode.Uri.file(questionPath),
      new vscode.Position(0, 0)
    );
  }

  private getConfirmedQuestionId(
    document: vscode.TextDocument,
    position: vscode.Position,
    range: vscode.Range
  ): string | null {
    console.log("prairielearn -- falling back to old parser");

    const line = document.lineAt(position.line).text;
    const idMatch = line.match(/"id"\s*:\s*"([^"]+)"/);

    if (idMatch) {
      return idMatch[1]; // e.g., "ch02/difficult"
    }

    try {
      // try to determine by parsing the entire JSON document
      const json = JSON.parse(document.getText());
      const clickedText = document.getText(range).replace(/"/g, "");

      return this.isQuestionId(json, clickedText) ? clickedText : null;
    } catch (e) {
      if (!(e instanceof SyntaxError)) {
        console.error("prairielearn -- unexpected error parsing json: " + e);
      }
    }

    return null;
  }

  private isQuestionId(obj: any, value: string): boolean {
    if (typeof obj !== "object" || obj === null) {
      return false;
    }

    for (const key in obj) {
      if (key === "id" && obj[key] === value) {
        return true;
      }
      if (typeof obj[key] === "object" && this.isQuestionId(obj[key], value)) {
        return true;
      }
    }

    return false;
  }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "prairielearn-navigator" is now active!'
  );

  context.subscriptions.push(
    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    vscode.commands.registerCommand("prairielearn-navigator.helloWorld", () => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      vscode.window.showInformationMessage(
        "Hello World from prairielearn-navigator!"
      );
    }),
    // Register the jump-to-def provider in infoAssessments
    vscode.languages.registerDefinitionProvider(
      [{ pattern: "**/infoAssessment.json" }],
      new PrairieLearnAssessmentDefinitionProvider()
    )
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
