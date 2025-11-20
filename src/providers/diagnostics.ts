import * as vscode from "vscode";
import { questionFilePathsFromId } from "./utils";
import { CourseCache, QuestionIdCache } from "./filewatchers";

abstract class ReferenceBasedDiagnosticCollection {
  protected collection: vscode.DiagnosticCollection;
  constructor(questionCache: QuestionIdCache) {
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

export class IncompleteQuestionDiagnosticCollection extends ReferenceBasedDiagnosticCollection {
  public constructor(
    questionCache: QuestionIdCache,
    private courseCache: CourseCache
  ) {
    super(questionCache);
  }

  protected diagnosticsFor(document: vscode.TextDocument) {
    if (!document.uri.fsPath.endsWith("infoAssessment.json")) {
      return;
    }
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();

    // Find all "id" field positions
    const idMatches = Array.from(text.matchAll(/"id"\s*:\s*"([^"]+)"/g));

    for (const match of idMatches) {
      const id = match[1];

      const paths = questionFilePathsFromId(document, id);

      const endOffset = match.index + match[0].length;
      const range = new vscode.Range(
        document.positionAt(endOffset - (id.length + 1)),
        document.positionAt(endOffset - 1)
      );

      let existingPaths;
      if (!paths || !(existingPaths = paths.strict()).dir) {
        const courseRoot =
          this.courseCache?.getCourseIdFor(document.uri) ??
          vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ??
          "${workspaceRoot}";
        const diagnostic = new vscode.Diagnostic(
          range,
          `missing question: expected question directory ${courseRoot}/questions/${id}`,
          vscode.DiagnosticSeverity.Error
        );
        if (paths) {
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
