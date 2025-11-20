import * as vscode from "vscode";
import { QuestionIdCache } from "./providers/filewatchers";
import { AssessmentDefinitionProvider } from "./providers/definitions";
import { AssessmentCompletionItemProvider } from "./providers/completions";
import {
  DuplicatedQuestionDiagnosticCollection,
  IncompleteQuestionDiagnosticCollection,
} from "./providers/diagnostics";
import {
  AssessmentCodeLensProvider,
  QuestionHeaderCodeLensProvider,
} from "./providers/lenses";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log("prairielearn-navigator is now active!");

  const infoAssessmentPatterns = [
    { pattern: "**/assessments/**/infoAssessment.json" },
  ];

  const cache = new QuestionIdCache();

  cache.onDidChange((ids) =>
    console.info(`prairielearn -- cache update ${ids}`)
  );

  context.subscriptions.push(
    // Shared Utilities
    cache,

    // Diagnostics
    ...new DuplicatedQuestionDiagnosticCollection(cache).subscriptions(),
    ...new IncompleteQuestionDiagnosticCollection(cache).subscriptions(),

    // Commands
    vscode.commands.registerCommand(
      "prairielearn-navigator.openFile",
      async (path: string, selection?: vscode.Range) => {
        await vscode.window.showTextDocument(vscode.Uri.file(path), {
          selection,
        });
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
    vscode.commands.registerCommand(
      "prairielearn-navigator.showOccurrences",
      async (occurrences: vscode.Location[]) => {
        if (occurrences.length === 0) {
          vscode.window.showInformationMessage("No references found");
          return;
        }

        // Show in references view
        await vscode.commands.executeCommand(
          "editor.action.showReferences",
          occurrences[0].uri,
          occurrences[0].range.start,
          occurrences
        );
      }
    ),

    // Jump-to-Definition Providers
    vscode.languages.registerDefinitionProvider(
      infoAssessmentPatterns,
      new AssessmentDefinitionProvider()
    ),

    // Completion Providers
    vscode.languages.registerCompletionItemProvider(
      infoAssessmentPatterns,
      new AssessmentCompletionItemProvider(cache),
      `"`
    ),

    // CodeLens Providers
    vscode.languages.registerCodeLensProvider(
      infoAssessmentPatterns,
      new AssessmentCodeLensProvider()
    ),
    vscode.languages.registerCodeLensProvider(
      [
        { pattern: "**/questions/**/info.json" },
        { pattern: "**/questions/**/question.html" },
        { pattern: "**/questions/**/server.py" },
      ],
      new QuestionHeaderCodeLensProvider()
    )
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
