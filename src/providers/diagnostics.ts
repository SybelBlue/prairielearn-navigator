import * as vscode from "vscode";
import { getQuestionDirFromId, questionFilePathsFromId } from "./utils";
import { CourseCache, QuestionCache } from "./filewatchers";

abstract class ReferenceBasedDiagnosticCollection {
  protected collection: vscode.DiagnosticCollection;
  constructor(
    protected courseCache: CourseCache,
    questionCache: QuestionCache
  ) {
    this.collection = vscode.languages.createDiagnosticCollection(
      "prairielearn-navigator"
    );

    questionCache.onDidChange(() => this.updateOpenDocuments());

    // Check already open documents once on init
    this.updateOpenDocuments();
  }

  updateOpenDocuments() {
    vscode.workspace.textDocuments.forEach((doc) => {
      this.update(doc);
    });
  }

  subscriptions(): vscode.Disposable[] {
    return [
      this.collection,

      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.update(doc);
      }),

      vscode.workspace.onDidChangeTextDocument((e) => {
        this.update(e.document);
      }),
    ];
  }

  private update(document: vscode.TextDocument) {
    const ds = this.diagnosticsFor(document);
    if (ds === null || ds === undefined) {
      return;
    }
    this.collection.set(document.uri, ds);
  }

  protected abstract diagnosticsFor(
    document: vscode.TextDocument
  ): vscode.Diagnostic[] | null | undefined;
}

export class DuplicatedQuestionDiagnosticCollection extends ReferenceBasedDiagnosticCollection {
  protected diagnosticsFor(document: vscode.TextDocument) {
    if (!document.uri.fsPath.endsWith("infoAssessment.json")) {
      return;
    }
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();

    try {
      const idPositions = new Map<string, number[]>();

      // Find all "id" field positions
      const idMatches = Array.from(text.matchAll(/"id"\s*:\s*"([^"]+)"/g));

      for (const match of idMatches) {
        const id = match[1];
        const offset = match.index! + match[0].indexOf(id);

        if (!idPositions.has(id)) {
          idPositions.set(id, []);
        }
        idPositions.get(id)!.push(offset);
      }

      // Create diagnostics for duplicates
      for (const [id, positions] of idPositions) {
        if (positions.length > 1) {
          for (const offset of positions) {
            const start = document.positionAt(offset);
            const end = document.positionAt(offset + id.length);
            const range = new vscode.Range(start, end);

            const diagnostic = new vscode.Diagnostic(
              range,
              `Duplicate question ID: "${id}" appears ${positions.length} times`,
              vscode.DiagnosticSeverity.Warning
            );

            diagnostics.push(diagnostic);
          }
        }
      }
    } catch (e) {
      console.error("prairielearn -- error in duplicate diagnostics: " + e);
    }

    return diagnostics;
  }
}

export const incompleteQuestionDiagnosticCode =
  "prairielearn-navigator-incomplete";

export class IncompleteQuestionDiagnosticCollection extends ReferenceBasedDiagnosticCollection {
  protected diagnosticsFor(document: vscode.TextDocument) {
    if (!document.uri.fsPath.endsWith("infoAssessment.json")) {
      return;
    }
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const courseId = this.courseCache.getCourseIdFor(document.uri);

    // Find all "id" field positions
    const idMatches = Array.from(text.matchAll(/"id"\s*:\s*"([^"]+)"/g));

    for (const match of idMatches) {
      const id = { courseId, localId: match[1] };

      const paths = questionFilePathsFromId(id);

      const endOffset = match.index + match[0].length;
      const range = new vscode.Range(
        document.positionAt(endOffset - (id.localId.length + 1)),
        document.positionAt(endOffset - 1)
      );

      let existingPaths;
      if (!paths || !(existingPaths = paths.strict()).dir) {
        const diagnostic = new vscode.Diagnostic(
          range,
          `missing question: expected question directory ${getQuestionDirFromId(
            id
          )}`,
          vscode.DiagnosticSeverity.Error
        );
        if (paths) {
          diagnostic.code = incompleteQuestionDiagnosticCode;
          diagnostic.relatedInformation = [
            new vscode.DiagnosticRelatedInformation(
              new vscode.Location(
                vscode.Uri.file(paths.infoJson),
                new vscode.Range(0, 0, 0, 0)
              ),
              "Expected location of info.json"
            ),
          ];
        }
        diagnostics.push(diagnostic);
        continue;
      }
      if (!existingPaths.infoJson) {
        const diagnostic = new vscode.Diagnostic(
          range,
          `incomplete question: missing required JSON file`,
          vscode.DiagnosticSeverity.Error
        );

        diagnostic.code = incompleteQuestionDiagnosticCode;
        diagnostic.relatedInformation = [
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(
              vscode.Uri.file(paths.infoJson),
              new vscode.Range(0, 0, 0, 0)
            ),
            "Expected location of info.json"
          ),
        ];
        diagnostics.push(diagnostic);
      }
      if (!existingPaths.questionHtml) {
        const diagnostic = new vscode.Diagnostic(
          range,
          `incomplete question: missing required html file`,
          vscode.DiagnosticSeverity.Error
        );

        diagnostic.code = incompleteQuestionDiagnosticCode;
        diagnostic.relatedInformation = [
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(
              vscode.Uri.file(paths.questionHtml),
              new vscode.Range(0, 0, 0, 0)
            ),
            "Expected location of question.html"
          ),
        ];
        diagnostics.push(diagnostic);
      }
    }

    return diagnostics;
  }
}

export class IncompleteQuestionQuickFixProvider
  implements vscode.CodeActionProvider
{
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const quickFixes: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== incompleteQuestionDiagnosticCode) {
        continue;
      }
      const diagInfo = diagnostic.relatedInformation?.at(0);
      if (diagInfo === undefined) {
        continue;
      }
      const fix = new vscode.CodeAction(
        "create missing " + (diagInfo.message.split(" ").at(-1) ?? "file"),
        vscode.CodeActionKind.QuickFix
      );

      fix.diagnostics = [diagnostic];
      fix.isPreferred = true;

      fix.edit = new vscode.WorkspaceEdit();
      fix.edit.createFile(diagInfo.location.uri, {
        ignoreIfExists: true,
        overwrite: false,
      });

      quickFixes.push(fix);
    }

    return quickFixes;
  }
}
