import * as vscode from "vscode";
import { commands } from "./commands";
import {
  AssessmentCache,
  AssessmentJumpToSourcesCodeLensProvider,
  AssessmentCompletionItemProvider,
  AssessmentDefinitionProvider,
  DuplicatedQuestionDiagnosticCollection,
  IncompleteQuestionDiagnosticCollection,
  QuestionHeaderCodeLensProvider,
  QuestionIdCache,
  utils,
} from "./providers";
import { CourseCache, CourseInstanceCache } from "./providers/filewatchers";

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
  const questionCache = new QuestionIdCache(courseCache);
  const assessmentCache = new AssessmentCache(questionCache);

  courseCache.onDidChange((ids) =>
    console.info(`prairielearn -- course cache update: ${ids}`)
  );
  courseInstanceCache.onDidChange((uris) =>
    console.info(
      // `prairielearn -- course instance cache update: n=${ids.length}`
      `prairielearn -- course instance cache update: ${uris.map(
        (uris) => uris.fsPath
      )}`
    )
  );
  questionCache.onDidChange((ids) =>
    // console.info(`prairielearn -- question cache update: n=${ids.length}`)
    console.info(
      `prairielearn -- question cache update: ${ids.map((qid) => qid.localId)}`
    )
  );
  assessmentCache.onDidChange((uris) =>
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
      questionCache,
      courseCache
    ).subscriptions(),
    ...new IncompleteQuestionDiagnosticCollection(
      questionCache,
      courseCache
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
      new AssessmentJumpToSourcesCodeLensProvider(courseCache)
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
