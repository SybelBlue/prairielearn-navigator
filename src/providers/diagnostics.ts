import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { isExcluded } from "../core/config";
import { courseRelativePath } from "../core/courseFiles";
import type * as core from "../core/diagnostic";
import { refSpecs } from "../core/references/specs";
import { ruleDiagnosticCode } from "../core/rules/registry";
import { checkableGlobs, isCheckable, runRules } from "../core/rules/run";
import { CourseCache, ReferenceIndexCache } from "../filewatchers";
import { ConfigProvider } from "./config";

const debounceMs = 300;
const batchSize = 32;

/**
 * Runs the core rule registry on every checkable file of every course in
 * the workspace, like the CLI: open documents from their live text, the
 * rest from disk, kept current as either changes.
 */
export class RuleDiagnosticCollection {
  private collection: vscode.DiagnosticCollection;
  private timers = new Map<string, NodeJS.Timeout>();
  /** Bumped per check of a file, so a slower, older check never wins. */
  private generation = new Map<string, number>();
  private checkAllTimer: NodeJS.Timeout | undefined;

  constructor(
    private courseCache: CourseCache,
    private references: ReferenceIndexCache,
    private configs: ConfigProvider
  ) {
    this.collection = vscode.languages.createDiagnosticCollection(
      "prairielearn-navigator"
    );

    // A referenced file appearing, changing, or disappearing only affects
    // the files that reference it
    references.onChanged(({ affected }) => affected.forEach((f) => this.checkFile(f)));
    configs.onChanged(() => this.scheduleCheckAll());
    courseCache.onUpdated(() => this.scheduleCheckAll());
    this.scheduleCheckAll();
  }

  subscriptions(): vscode.Disposable[] {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.{json,html}");
    const onDisk = (uri: vscode.Uri) => {
      // Open documents are checked from their text as it changes
      if (!this.openDocument(uri.fsPath)) {
        this.checkFile(uri.fsPath);
      }
    };
    return [
      this.collection,
      watcher,
      watcher.onDidCreate(onDisk),
      watcher.onDidChange(onDisk),
      watcher.onDidDelete((uri) => this.checkFile(uri.fsPath)),
      vscode.workspace.onDidOpenTextDocument((doc) => this.checkFile(doc.uri.fsPath)),
      vscode.workspace.onDidChangeTextDocument((e) => this.scheduleCheck(e.document)),
      // Unsaved changes are discarded on close: go back to the disk
      vscode.workspace.onDidCloseTextDocument((doc) => this.checkFile(doc.uri.fsPath)),
      {
        dispose: () => {
          this.timers.forEach((t) => clearTimeout(t));
          clearTimeout(this.checkAllTimer);
        },
      },
    ];
  }

  private scheduleCheck(document: vscode.TextDocument) {
    const key = document.uri.fsPath;
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.checkFile(key);
      }, debounceMs)
    );
  }

  /** Courses are discovered a few at a time on startup, so settle first. */
  private scheduleCheckAll() {
    clearTimeout(this.checkAllTimer);
    this.checkAllTimer = setTimeout(() => {
      this.courseCache.getCourseIds().forEach((root) => this.checkCourse(root));
    }, debounceMs);
  }

  private async checkCourse(courseRoot: string) {
    const started = Date.now();
    // Build the index, so changes to referenced files are reported
    this.references.indexFor(vscode.Uri.file(courseRoot));
    const files = checkableFiles(courseRoot);
    const current = new Set(files);
    // Forget files that are gone or no longer checkable
    this.collection.forEach((uri) => {
      if (uri.fsPath.startsWith(courseRoot + path.sep) && !current.has(uri.fsPath)) {
        this.collection.delete(uri);
      }
    });
    for (let i = 0; i < files.length; i += batchSize) {
      await Promise.all(files.slice(i, i + batchSize).map((f) => this.checkFile(f)));
    }
    console.info(`prairielearn -- checked ${files.length} files in ${courseRoot} in ${Date.now() - started}ms`);
  }

  private openDocument(file: string): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(
      (d) => d.uri.scheme === "file" && d.uri.fsPath === file && !d.isClosed
    );
  }

  private async checkFile(file: string) {
    const uri = vscode.Uri.file(file);
    const generation = (this.generation.get(file) ?? 0) + 1;
    this.generation.set(file, generation);
    const courseRoot = this.courseCache.getCourseIdFor(uri);
    if (!courseRoot || !isCheckable(courseRelativePath(courseRoot, file))) {
      return;
    }
    try {
      const config = this.configs.configFor(courseRoot);
      const text =
        this.openDocument(file)?.getText() ??
        (await fs.promises.readFile(file, "utf-8").catch(() => undefined));
      if (text === undefined || isExcluded(config, file)) {
        this.collection.delete(uri);
        return;
      }
      const schemas = this.configs.schemasFor(config);
      const diagnostics = await runRules(file, text, { courseRoot, config, schemas });
      this.configs.reportSchemaProblems(schemas);
      if (this.generation.get(file) === generation) {
        this.collection.set(uri, toVscodeDiagnostics(text, diagnostics));
      }
    } catch (e) {
      console.error("prairielearn -- error running rules: " + e);
    }
  }
}

/** Every file in a course that some rule applies to. */
function checkableFiles(courseRoot: string): string[] {
  return fs
    .globSync(checkableGlobs(), { cwd: courseRoot })
    .map((rel) => path.join(courseRoot, rel));
}

function toVscodeDiagnostics(
  text: string,
  diagnostics: core.Diagnostic[]
): vscode.Diagnostic[] {
  const lineStarts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    lineStarts.push(i + 1);
  }
  const positionAt = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return new vscode.Position(lo, offset - lineStarts[lo]);
  };
  return diagnostics.map((d) => {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(positionAt(d.startOffset), positionAt(d.endOffset)),
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
