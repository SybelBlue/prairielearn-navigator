import * as crypto from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { courseRelativePath } from "../core/courseFiles";
import type * as core from "../core/diagnostic";
import { refSpecs } from "../core/references/specs";
import { ruleDiagnosticCode } from "../core/rules/registry";
import { isCheckable, runRules } from "../core/rules/run";
import { CourseCache, ReferenceIndexCache } from "../filewatchers";
import { ConfigProvider } from "./config";

const debounceMs = 300;

/** Runs the core rule registry on every open course JSON document. */
export class RuleDiagnosticCollection {
  private collection: vscode.DiagnosticCollection;
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private courseCache: CourseCache,
    private references: ReferenceIndexCache,
    private configs: ConfigProvider
  ) {
    this.collection = vscode.languages.createDiagnosticCollection(
      "prairielearn-navigator"
    );

    // A referenced file appearing, changing, or disappearing only affects
    // the open documents that reference it
    references.onChanged(({ affected }) => {
      const files = new Set(affected);
      vscode.workspace.textDocuments
        .filter((doc) => files.has(doc.uri.fsPath))
        .forEach((doc) => this.update(doc));
    });
    configs.onChanged(() => this.updateOpenDocuments());

    // Check already open documents once on init
    this.updateOpenDocuments();
  }

  updateOpenDocuments() {
    vscode.workspace.textDocuments.forEach((doc) => this.update(doc));
  }

  subscriptions(): vscode.Disposable[] {
    return [
      this.collection,
      vscode.workspace.onDidOpenTextDocument((doc) => this.update(doc)),
      vscode.workspace.onDidChangeTextDocument((e) =>
        this.scheduleUpdate(e.document)
      ),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        clearTimeout(this.timers.get(doc.uri.toString()));
        this.collection.delete(doc.uri);
      }),
      { dispose: () => this.timers.forEach((t) => clearTimeout(t)) },
    ];
  }

  private scheduleUpdate(document: vscode.TextDocument) {
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.update(document);
      }, debounceMs)
    );
  }

  private async update(document: vscode.TextDocument) {
    if (document.uri.scheme !== "file") {
      return;
    }
    const courseRoot = this.courseCache.getCourseIdFor(document.uri);
    if (
      !courseRoot ||
      !isCheckable(courseRelativePath(courseRoot, document.uri.fsPath))
    ) {
      return;
    }
    const version = document.version;
    // Build the index, so changes to this document's targets are reported
    this.references.indexFor(document.uri);
    try {
      const config = this.configs.configFor(courseRoot);
      const schemas = this.configs.schemasFor(config);
      const diagnostics = await runRules(
        document.uri.fsPath,
        document.getText(),
        { courseRoot, config, schemas }
      );
      this.configs.reportSchemaProblems(schemas);
      // Drop results for text that has since changed or been closed
      if (document.version === version && !document.isClosed) {
        this.collection.set(document.uri, toVscodeDiagnostics(document, diagnostics));
      }
    } catch (e) {
      console.error("prairielearn -- error running rules: " + e);
    }
  }
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
    diagnostic.source = "prairielearn-navigator";
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

/** Diagnostics whose first related location is a file the fix can create. */
const missingFileCodes = new Set<unknown>(
  refSpecs
    .filter((spec) => spec.target !== "fileOrDir")
    .map((spec) => ruleDiagnosticCode(spec.rule))
);

export class MissingFileQuickFixProvider
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
      if (!missingFileCodes.has(diagnostic.code)) {
        continue;
      }
      const diagInfo = diagnostic.relatedInformation?.at(0);
      if (diagInfo === undefined) {
        continue;
      }
      const fileName = path.basename(diagInfo.location.uri.fsPath);
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
