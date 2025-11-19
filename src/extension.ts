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
  ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
    console.log("prairielearn -- provideDef");

    // Get the word/range at the cursor position
    const range = document.getWordRangeAtPosition(position, /"([^"]+)"/);
    if (!range) {
      return null;
    }

    const line = document.lineAt(position.line).text;
    const idMatch = line.match(/"id"\s*:\s*"([^"]+)"/);

    if (!idMatch) {
      return null;
    }

    const questionId = idMatch[1]; // e.g., "ch02/difficult"
    console.log("prairielearn -- questionId:" + questionId);

    // Resolve to questions/ch02/difficult/info.json
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

    const targetUri = vscode.Uri.file(questionPath);

    return new vscode.Location(targetUri, new vscode.Position(0, 0));
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
    // Register the custom provider
    vscode.languages.registerDefinitionProvider(
      [{ pattern: "**/infoAssessment.json" }],
      new PrairieLearnAssessmentDefinitionProvider()
    )
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
