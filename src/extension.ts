import * as vscode from "vscode";
import { AssessmentCache, QuestionIdCache } from "./providers/filewatchers";
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
import { getAssessmentLabelFromUri } from "./providers/utils";

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
        `prairielearn-navigator.${cmdName}`,
        cmdImpl
      )
    );
  }

  // setup caches
  const questionCache = new QuestionIdCache();
  const assessmentCache = new AssessmentCache(questionCache);

  questionCache.onDidChange((ids) =>
    console.info(`prairielearn -- question cache update ${ids}`)
  );
  assessmentCache.onDidChange((uris) =>
    console.info(
      `prairielearn -- assessment cache update ${uris.map((u) =>
        getAssessmentLabelFromUri(u)
      )}`
    )
  );

  // helpful constant
  const infoAssessmentPatterns = [
    { pattern: "**/assessments/**/infoAssessment.json" },
  ];

  context.subscriptions.push(
    // Shared Utilities
    questionCache,
    assessmentCache,

    // Diagnostics
    ...new DuplicatedQuestionDiagnosticCollection(
      questionCache
    ).subscriptions(),
    ...new IncompleteQuestionDiagnosticCollection(
      questionCache
    ).subscriptions(),

    // Jump-to-Definition Providers
    vscode.languages.registerDefinitionProvider(
      infoAssessmentPatterns,
      new AssessmentDefinitionProvider()
    ),

    // IntelliSense Completion Providers
    vscode.languages.registerCompletionItemProvider(
      infoAssessmentPatterns,
      new AssessmentCompletionItemProvider(questionCache),
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
      new QuestionHeaderCodeLensProvider(assessmentCache)
    )
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
