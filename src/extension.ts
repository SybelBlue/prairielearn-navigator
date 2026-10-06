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
  AssessmentQuestionIdCodeLensProvider,
  ConfigProvider,
  CourseHeaderCodeLensProvider,
  CourseInstanceHeaderCodeLensProvider,
  FileReferenceProvider,
  fileReferenceSelector,
  MissingFileQuickFixProvider,
  QuestionHeaderCodeLensProvider,
  RuleDiagnosticCollection,
} from "./providers";
import { DebugView } from "./debugView";
import { QuestionCompletionItemProvider } from "./providers/completions";

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
        cmdImpl,
      ),
    );
  }

  // setup caches
  const courseCache = new CourseCache();
  const instanceCache = new CourseInstanceCache(courseCache);
  const questionCache = new QuestionCache(courseCache);
  const assessmentCache = new AssessmentCache(courseCache, questionCache);
  const configProvider = new ConfigProvider(context);
  const fileReferenceProvider = new FileReferenceProvider(
    courseCache,
    configProvider,
  );

  new DebugView(courseCache, instanceCache, assessmentCache, questionCache);
  courseCache.onUpdated((ids) =>
    console.info(`prairielearn -- course cache update: ${ids}`),
  );
  instanceCache.onUpdated((uris) =>
    console.info(
      uris.length > 6
        ? `prairielearn -- course instance cache update: n=${uris.length}`
        : `prairielearn -- course instance cache update: ${uris.map(
            (uris) => uris.fsPath,
          )}`,
    ),
  );
  questionCache.onUpdated((ids) =>
    ids.length > 6
      ? console.info(`prairielearn -- question cache update: n=${ids.length}`)
      : console.info(
          `prairielearn -- question cache update: ${ids.map(
            (qid) => qid.localId,
          )}`,
        ),
  );
  assessmentCache.onUpdated((uris) =>
    console.info(`prairielearn -- assessment cache update: n=${uris.length}`),
  );

  // helpful constants
  const infoQuestionPatterns = [{ pattern: "**/questions/**/info.json" }];
  const infoAssessmentPatterns = [
    { pattern: "**/assessments/**/infoAssessment.json" },
  ];

  context.subscriptions.push(
    // Shared Utilities
    courseCache,
    instanceCache,
    questionCache,
    assessmentCache,
    configProvider,
    vscode.commands.registerCommand(
      "prairielearn-navigator.reloadSchemas",
      () => configProvider.reset(true),
    ),

    // Diagnostics
    ...new RuleDiagnosticCollection(
      courseCache,
      questionCache,
      configProvider,
    ).subscriptions(),

    // Jump-to-File Providers
    vscode.languages.registerDefinitionProvider(
      fileReferenceSelector,
      fileReferenceProvider,
    ),
    vscode.languages.registerDocumentLinkProvider(
      fileReferenceSelector,
      fileReferenceProvider,
    ),

    // IntelliSense Completion Providers
    vscode.languages.registerCompletionItemProvider(
      infoAssessmentPatterns,
      new AssessmentCompletionItemProvider(questionCache),
      `"`,
    ),
    vscode.languages.registerCompletionItemProvider(
      infoQuestionPatterns,
      new QuestionCompletionItemProvider(questionCache),
      `"`,
    ),

    // CodeLens Providers
    vscode.languages.registerCodeLensProvider(
      infoAssessmentPatterns,
      new AssessmentQuestionIdCodeLensProvider(courseCache, assessmentCache),
    ),
    vscode.languages.registerCodeLensProvider(
      [
        { pattern: "**/questions/**/info.json" },
        { pattern: "**/questions/**/question.html" },
        { pattern: "**/questions/**/server.py" },
      ],
      new QuestionHeaderCodeLensProvider(courseCache, assessmentCache),
    ),
    vscode.languages.registerCodeLensProvider(
      { pattern: "**/infoCourse.json" },
      new CourseHeaderCodeLensProvider(courseCache, instanceCache),
    ),
    vscode.languages.registerCodeLensProvider(
      { pattern: "**/infoCourseInstance.json" },
      new CourseInstanceHeaderCodeLensProvider(
        courseCache,
        instanceCache,
        assessmentCache,
      ),
    ),

    // Code Action Providers
    vscode.languages.registerCodeActionsProvider(
      "json",
      new MissingFileQuickFixProvider(),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      },
    ),
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
