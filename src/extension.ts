// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

function questionDirFromId(
  document: vscode.TextDocument,
  questionId: string
): null | string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    return null;
  }

  return path.join(workspaceFolder.uri.fsPath, "questions", questionId);
}

type QuestionPaths = {
  infoJson: string;
  html: string;
  serverPy: string;
};

function questionFilePathsFromId(
  document: vscode.TextDocument,
  questionId: string
): (QuestionPaths & { dir: string; strict(): Partial<QuestionPaths> }) | null {
  const dir = questionDirFromId(document, questionId);

  if (!dir || !fs.existsSync(dir)) {
    console.log(`prairielearn -- directory ${dir} DNE`);
    return null;
  }

  const infoJson = path.join(dir, "info.json");
  const html = path.join(dir, "question.html");
  const serverPy = path.join(dir, "server.py");
  return {
    dir,
    infoJson,
    html,
    serverPy,
    /** Only returns existing file-paths */
    strict(): Partial<QuestionPaths> {
      const out: Partial<QuestionPaths> = {};
      if (fs.existsSync(infoJson)) {
        out.infoJson = infoJson;
      }
      if (fs.existsSync(html)) {
        out.html = html;
      }
      if (fs.existsSync(serverPy)) {
        out.serverPy = serverPy;
      }
      return out;
    },
  };
}

class PrairieLearnAssessmentDefinitionProvider
  implements vscode.DefinitionProvider
{
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition> {
    function isQuestionId(obj: any, value: string): boolean {
      if (typeof obj !== "object" || obj === null) {
        return false;
      }

      for (const key in obj) {
        if (key === "id" && obj[key] === value) {
          return true;
        }
        if (typeof obj[key] === "object" && isQuestionId(obj[key], value)) {
          return true;
        }
      }

      return false;
    }

    function getConfirmedQuestionId(
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

        return isQuestionId(json, clickedText) ? clickedText : null;
      } catch (e) {
        if (!(e instanceof SyntaxError)) {
          console.error("prairielearn -- unexpected error parsing json: " + e);
        }
      }

      return null;
    }

    // Get the range of the quoted string at cursor
    const range = document.getWordRangeAtPosition(position, /"([^"]+)"/);
    if (!range) {
      return null;
    }

    const questionId = getConfirmedQuestionId(document, position, range);
    if (!questionId) {
      return null;
    }

    console.log("prairielearn -- questionId:" + questionId);
    const questionDirPath = questionDirFromId(document, questionId);

    if (!questionDirPath || !fs.existsSync(questionDirPath)) {
      console.log(`prairielearn -- directory ${questionDirPath} DNE`);
      return null;
    }

    const questionHtmlPath = path.join(questionDirPath, "question.html");
    const questionInfoJsonPath = path.join(questionDirPath, "info.json");

    const definitionPath = fs.existsSync(questionHtmlPath)
      ? questionHtmlPath
      : questionInfoJsonPath;

    if (!definitionPath) {
      return null;
    }

    return new vscode.Location(
      vscode.Uri.file(definitionPath),
      new vscode.Position(0, 0)
    );
  }
}

class PrairieLearnAssessmentCodeLensProvider
  implements vscode.CodeLensProvider
{
  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();

    const re = /"id"\s*:[\n\s]*"([^"]+)"/g;
    let match;
    while ((match = re.exec(text))) {
      const questionId = match[1];
      const matchRange = new vscode.Range(
        document.positionAt(match.index),
        document.positionAt(match.index + match[0].length)
      );
      const questionPaths = questionFilePathsFromId(document, questionId);
      if (!questionPaths) {
        lenses.push(
          new vscode.CodeLens(matchRange, {
            title: `!! Unknown Id !!`,
            command: "prairielearn-navigator.unknownId",
            arguments: [questionId],
          })
        );
        continue;
      }

      for (const p of Object.values(questionPaths.strict())) {
        lenses.push(
          new vscode.CodeLens(matchRange, {
            title: `${path.basename(p)}`,
            command: "prairielearn-navigator.openFile",
            arguments: [p],
          })
        );
      }
    }

    return lenses;
  }

  private getQuestionIdFromDocument(document: vscode.TextDocument): string {
    // Extract from path: questions/ch02/difficult/info.json -> ch02/difficult
    const pathParts = document.uri.fsPath.split(path.sep);
    const questionsIndex = pathParts.indexOf("questions");
    return pathParts.slice(questionsIndex + 1, -1).join("/");
  }

  private getUsageCount(questionId: string): number {
    return 0; // placeholder
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
    vscode.commands.registerCommand(
      "prairielearn-navigator.openFile",
      async (path: string) => {
        await vscode.window.showTextDocument(vscode.Uri.file(path));
      }
    ),
    vscode.commands.registerCommand(
      "prairielearn-navigator.unknownId",
      (questionId: string) => {
        vscode.window.showInformationMessage(
          `question id "${questionId}" does not exist`
        );
      }
    ),
    // Register the jump-to-def provider in infoAssessments
    vscode.languages.registerDefinitionProvider(
      [{ pattern: "**/infoAssessment.json" }],
      new PrairieLearnAssessmentDefinitionProvider()
    ),
    // Register inlay hints provider for infoAssessments
    vscode.languages.registerCodeLensProvider(
      [{ pattern: "**/infoAssessment.json" }],
      new PrairieLearnAssessmentCodeLensProvider()
    )
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
