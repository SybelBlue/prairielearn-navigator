import * as vscode from "vscode";
import { commands } from "./commands";
import {
  AssessmentCache,
  CourseCache,
  CourseInstanceCache,
  QuestionCache,
} from "./filewatchers";
import {
  AssessmentCompletionItemProvider,
  AssessmentDefinitionProvider,
  AssessmentJumpToSourcesCodeLensProvider,
  DuplicatedQuestionDiagnosticCollection,
  IncompleteQuestionDiagnosticCollection,
  IncompleteQuestionQuickFixProvider,
  QuestionHeaderCodeLensProvider,
} from "./providers";

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
  const courseCache = new CourseCache();
  const courseInstanceCache = new CourseInstanceCache(courseCache);
  const questionCache = new QuestionCache(courseCache);
  const assessmentCache = new AssessmentCache(courseCache, questionCache);

  courseCache.onUpdated((ids) =>
    console.info(`prairielearn -- course cache update: ${ids}`)
  );
  courseInstanceCache.onUpdated((uris) =>
    console.info(
      uris.length > 6
        ? `prairielearn -- course instance cache update: n=${uris.length}`
        : `prairielearn -- course instance cache update: ${uris.map(
            (uris) => uris.fsPath
          )}`
    )
  );
  questionCache.onUpdated((ids) =>
    ids.length > 6
      ? console.info(`prairielearn -- question cache update: n=${ids.length}`)
      : console.info(
          `prairielearn -- question cache update: ${ids.map(
            (qid) => qid.localId
          )}`
        )
  );
  assessmentCache.onUpdated((uris) =>
    console.info(`prairielearn -- assessment cache update: n=${uris.length}`)
  );

  // helpful constant
  const infoAssessmentPatterns = [
    { pattern: "**/assessments/**/infoAssessment.json" },
  ];

  context.subscriptions.push(
    // Shared Utilities
    courseCache,
    courseInstanceCache,
    questionCache,
    assessmentCache,

    // Diagnostics
    ...new DuplicatedQuestionDiagnosticCollection(
      courseCache,
      questionCache
    ).subscriptions(),
    ...new IncompleteQuestionDiagnosticCollection(
      courseCache,
      questionCache
    ).subscriptions(),

    // Jump-to-Definition Providers
    vscode.languages.registerDefinitionProvider(
      infoAssessmentPatterns,
      new AssessmentDefinitionProvider(courseCache)
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
      new AssessmentJumpToSourcesCodeLensProvider(courseCache, assessmentCache)
    ),
    vscode.languages.registerCodeLensProvider(
      [
        { pattern: "**/questions/**/info.json" },
        { pattern: "**/questions/**/question.html" },
        { pattern: "**/questions/**/server.py" },
      ],
      new QuestionHeaderCodeLensProvider(courseCache, assessmentCache)
    ),

    // Code Action Providers
    vscode.languages.registerCodeActionsProvider(
      "json",
      new IncompleteQuestionQuickFixProvider(),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }
    )
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
