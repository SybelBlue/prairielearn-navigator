import * as crypto from "node:crypto";
import * as vscode from "vscode";
import {
  checkDuplicateQuestionIds,
  checkIncompleteQuestions,
  incompleteQuestionDiagnosticCode,
} from "../core/checks";
import type * as core from "../core/diagnostic";
import { CourseCache, QuestionCache } from "../filewatchers";

abstract class ReferenceBasedDiagnosticCollection {
  protected collection: vscode.DiagnosticCollection;
  constructor(
    protected courseCache: CourseCache,
    questionCache: QuestionCache
  ) {
    this.collection = vscode.languages.createDiagnosticCollection(
      "prairielearn-navigator"
    );

    questionCache.onUpdated(() => this.updateOpenDocuments());

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

function toVscodeDiagnostics(
  document: vscode.TextDocument,
  diagnostics: core.Diagnostic[]
): vscode.Diagnostic[] {
  return diagnostics.map((d) => {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(
        document.positionAt(d.startOffset),
        document.positionAt(d.endOffset)
      ),
      d.message,
      d.severity === "error"
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning
    );
    if (d.code !== undefined) {
      diagnostic.code = d.code;
    }
    if (d.related !== undefined) {
      diagnostic.relatedInformation = d.related.map(
        (r) =>
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(
              vscode.Uri.file(r.path),
              new vscode.Range(0, 0, 0, 0)
            ),
            r.message
          )
      );
    }
    return diagnostic;
  });
}

export class DuplicatedQuestionDiagnosticCollection extends ReferenceBasedDiagnosticCollection {
  protected diagnosticsFor(document: vscode.TextDocument) {
    if (!document.uri.fsPath.endsWith("infoAssessment.json")) {
      return;
    }
    try {
      return toVscodeDiagnostics(
        document,
        checkDuplicateQuestionIds(document.getText())
      );
    } catch (e) {
      console.error("prairielearn -- error in duplicate diagnostics: " + e);
      return [];
    }
  }
}

export class IncompleteQuestionDiagnosticCollection extends ReferenceBasedDiagnosticCollection {
  protected diagnosticsFor(document: vscode.TextDocument) {
    if (!document.uri.fsPath.endsWith("infoAssessment.json")) {
      return;
    }
    const courseId = this.courseCache.getCourseIdFor(document.uri);
    return toVscodeDiagnostics(
      document,
      checkIncompleteQuestions(document.getText(), courseId)
    );
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
      const fileName = diagInfo.message.split(" ").at(-1) ?? "file";
      const fix = new vscode.CodeAction(
        "create missing " + fileName,
        vscode.CodeActionKind.QuickFix
      );

      fix.diagnostics = [diagnostic];
      fix.isPreferred = true;

      fix.edit = new vscode.WorkspaceEdit();
      let contents;
      if (fileName.endsWith(".json")) {
        const fileContents = JSON.stringify(
          {
            uuid: crypto.randomUUID(),
            title: "New Question",
            type: "v3",
          },
          undefined,
          2
        );
        contents = new TextEncoder().encode(fileContents);
      }
      fix.edit.createFile(diagInfo.location.uri, {
        ignoreIfExists: true,
        overwrite: false,
        contents,
      });

      quickFixes.push(fix);
    }

    return quickFixes;
  }
}
