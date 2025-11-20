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
import { commands } from "./commands";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log("prairielearn-navigator is now active!");

  // register commands
  for (const [cmdName, cmdImpl] of Object.entries(commands)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `priarielearn-navigator.${cmdName}`,
        cmdImpl
      )
    );
  }

  // setup cache
  const cache = new QuestionIdCache();

  cache.onDidChange((ids) =>
    console.info(`prairielearn -- cache update ${ids}`)
  );

  // helpful constant
  const infoAssessmentPatterns = [
    { pattern: "**/assessments/**/infoAssessment.json" },
  ];

  context.subscriptions.push(
    // Shared Utilities
    cache,

    // Diagnostics
    ...new DuplicatedQuestionDiagnosticCollection(cache).subscriptions(),
    ...new IncompleteQuestionDiagnosticCollection(cache).subscriptions(),

    // Jump-to-Definition Providers
    vscode.languages.registerDefinitionProvider(
      infoAssessmentPatterns,
      new AssessmentDefinitionProvider()
    ),

    // IntelliSense Completion Providers
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
