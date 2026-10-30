import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { findNodeAtLocation, modify, type Node, parseTree } from "jsonc-parser";
import { isExcluded } from "../core/config";
import { courseRelativePath } from "../core/courseFiles";
import type * as core from "../core/diagnostic";
import { refSpecs } from "../core/references/specs";
import { ruleDiagnosticCode } from "../core/rules/registry";
import { checkableGlobs, isCheckable, runCourseRules, runRules } from "../core/rules/run";
import { CourseCache, ReferenceIndexCache } from "../filewatchers";
import { ConfigProvider } from "./config";
import { generateUuid, reportUuidGenerationError } from "./uuid";

const batchSize = 32;
export const missingRootUuidDiagnosticCode =
  `${ruleDiagnosticCode("schema")}/missing-required-property/uuid`;
export const invalidRootUuidDiagnosticCode =
  `${ruleDiagnosticCode("schema")}/pattern/uuid`;

/**
 * Runs the core rule registry on every checkable file of every course in
 * the workspace, like the CLI: open documents from their live text, the
 * rest from disk, kept current as either changes.
 */
export class RuleDiagnosticCollection {
  private collection: vscode.DiagnosticCollection;
  /**
   * From rules over a whole course, kept apart so a file's own check never
   * replaces them.
   */
  private courseCollection: vscode.DiagnosticCollection;
  private timers = new Map<string, NodeJS.Timeout>();
  private courseTimers = new Map<string, NodeJS.Timeout>();
  /** Bumped per check of a file, so a slower, older check never wins. */
  private generation = new Map<string, number>();
  private checkAllTimer: NodeJS.Timeout | undefined;
  private referencedFiles = new Set<string>();
  private referencedFilesTimer: NodeJS.Timeout | undefined;

  constructor(
    private courseCache: CourseCache,
    private references: ReferenceIndexCache,
    private configs: ConfigProvider,
    private readonly debounceMs = 300,
  ) {
    this.collection = vscode.languages.createDiagnosticCollection(
      "prairielearn-navigator"
    );
    this.courseCollection = vscode.languages.createDiagnosticCollection(
      "prairielearn-navigator-course"
    );

    // A referenced file appearing, changing, or disappearing only affects
    // the files that reference it
    references.onChanged(({ affected }) => this.scheduleReferencedFiles(affected));
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
    // Any file or directory appearing or disappearing in questions/
    const questionsWatcher = vscode.workspace.createFileSystemWatcher(
      "**/questions/**", false, true, false
    );
    const onQuestions = (uri: vscode.Uri) => {
      const courseRoot = this.courseCache.getCourseIdFor(uri);
      if (courseRoot) {
        this.scheduleCourseRules(courseRoot);
      }
    };
    const onQuestionsDeleted = (uri: vscode.Uri) => {
      onQuestions(uri);
      const prefix = uri.fsPath + path.sep;
      for (const collection of [this.collection, this.courseCollection]) {
        collection.forEach((existing) => {
          if (
            existing.fsPath === uri.fsPath ||
            existing.fsPath.startsWith(prefix)
          ) {
            collection.delete(existing);
          }
        });
      }
    };
    return [
      this.collection,
      this.courseCollection,
      watcher,
      watcher.onDidCreate(onDisk),
      watcher.onDidChange(onDisk),
      watcher.onDidDelete((uri) => this.checkFile(uri.fsPath)),
      questionsWatcher,
      questionsWatcher.onDidCreate(onQuestions),
      questionsWatcher.onDidDelete(onQuestionsDeleted),
      vscode.workspace.onDidOpenTextDocument((doc) => this.checkFile(doc.uri.fsPath)),
      vscode.workspace.onDidChangeTextDocument((e) => this.scheduleCheck(e.document)),
      // Unsaved changes are discarded on close: go back to the disk
      vscode.workspace.onDidCloseTextDocument((doc) => this.checkFile(doc.uri.fsPath)),
      {
        dispose: () => {
          this.timers.forEach((t) => clearTimeout(t));
          this.courseTimers.forEach((t) => clearTimeout(t));
          clearTimeout(this.checkAllTimer);
          clearTimeout(this.referencedFilesTimer);
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
      }, this.debounceMs)
    );
  }

  private scheduleCourseRules(courseRoot: string) {
    clearTimeout(this.courseTimers.get(courseRoot));
    this.courseTimers.set(
      courseRoot,
      setTimeout(() => {
        this.courseTimers.delete(courseRoot);
        this.checkCourseRules(courseRoot);
      }, this.debounceMs)
    );
  }

  /** Courses are discovered a few at a time on startup, so settle first. */
  private scheduleCheckAll() {
    clearTimeout(this.checkAllTimer);
    this.checkAllTimer = setTimeout(() => {
      this.courseCache.getCourseIds().forEach((root) => this.checkCourse(root));
    }, this.debounceMs);
  }

  /** Deduplicates checks requested by a burst of related reference updates. */
  private scheduleReferencedFiles(files: string[]) {
    files.forEach((file) => this.referencedFiles.add(file));
    clearTimeout(this.referencedFilesTimer);
    this.referencedFilesTimer = setTimeout(() => {
      this.referencedFilesTimer = undefined;
      const pending = [...this.referencedFiles];
      this.referencedFiles.clear();
      pending.forEach((file) => void this.checkFile(file));
    }, Math.min(this.debounceMs, 10));
  }

  private async checkCourse(courseRoot: string) {
    const started = Date.now();
    // Wait for the index: rules read it, and changes to referenced files are reported through it
    await this.references.whenIndexed(vscode.Uri.file(courseRoot));
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
    this.checkCourseRules(courseRoot);
    console.info(`prairielearn -- checked ${files.length} files in ${courseRoot} in ${Date.now() - started}ms`);
  }

  private checkCourseRules(courseRoot: string) {
    try {
      const byFile = runCourseRules(courseRoot, this.configs.configFor(courseRoot));
      this.courseCollection.forEach((uri) => {
        if (uri.fsPath.startsWith(courseRoot + path.sep) && !byFile.has(uri.fsPath)) {
          this.courseCollection.delete(uri);
        }
      });
      // Each is at the start of a file that may not be text, so no text is needed
      byFile.forEach((diagnostics, file) =>
        this.courseCollection.set(vscode.Uri.file(file), toVscodeDiagnostics("", diagnostics))
      );
    } catch (e) {
      console.error("prairielearn -- error running course rules: " + e);
    }
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
      const references = this.references.indexFor(uri);
      const diagnostics = await runRules(file, text, { courseRoot, config, schemas, references });
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
        : d.severity === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information
    );
    diagnostic.source = "prairielearn-navigator";
    if (
      d.metadata?.kind === "schema-required-property" &&
      d.metadata.path.length === 0 &&
      d.metadata.property === "uuid"
    ) {
      diagnostic.code = missingRootUuidDiagnosticCode;
    } else if (
      d.metadata?.kind === "schema-pattern" &&
      d.metadata.path.length === 1 &&
      d.metadata.path[0] === "uuid"
    ) {
      diagnostic.code = invalidRootUuidDiagnosticCode;
    } else if (d.code !== undefined) {
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

function rootUuidNode(document: vscode.TextDocument): Node | undefined {
  const tree = parseTree(document.getText());
  return tree === undefined ? undefined : findNodeAtLocation(tree, ["uuid"]);
}

function hasRootUuid(document: vscode.TextDocument): boolean {
  return rootUuidNode(document) !== undefined;
}

function addUuidEdit(
  document: vscode.TextDocument,
  uuid: string,
): vscode.WorkspaceEdit {
  const workspaceEdit = new vscode.WorkspaceEdit();
  const indentation = document.getText().match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
  const edits = modify(document.getText(), ["uuid"], uuid, {
    formattingOptions: {
      insertSpaces: !indentation.includes("\t"),
      tabSize: indentation.includes("\t") ? 1 : indentation.length,
      eol: document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
    },
    getInsertionIndex: () => 0,
  });
  for (const edit of edits) {
    workspaceEdit.replace(
      document.uri,
      new vscode.Range(
        document.positionAt(edit.offset),
        document.positionAt(edit.offset + edit.length),
      ),
      edit.content,
    );
  }
  return workspaceEdit;
}

/** Command behind the missing and invalid root-UUID quick fixes. */
export async function addGeneratedUuid(
  uri: vscode.Uri,
  expectedValue?: string,
) {
  const document = await vscode.workspace.openTextDocument(uri);
  const current = rootUuidNode(document);
  if (
    (expectedValue === undefined && current !== undefined) ||
    (expectedValue !== undefined && current?.value !== expectedValue)
  ) {
    return;
  }
  try {
    const uuid = await generateUuid(document);
    await vscode.workspace.applyEdit(addUuidEdit(document, uuid));
  } catch (error) {
    reportUuidGenerationError(error);
  }
}

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
      if (
        diagnostic.code === missingRootUuidDiagnosticCode &&
        !hasRootUuid(document)
      ) {
        const fix = new vscode.CodeAction(
          "Add generated UUID",
          vscode.CodeActionKind.QuickFix,
        );
        fix.diagnostics = [diagnostic];
        fix.isPreferred = true;
        fix.command = {
          command: "prairielearn-navigator.addGeneratedUuid",
          title: fix.title,
          arguments: [document.uri],
        };
        quickFixes.push(fix);
        continue;
      }

      if (diagnostic.code === invalidRootUuidDiagnosticCode) {
        const currentValue = rootUuidNode(document)?.value;
        if (typeof currentValue !== "string") {
          continue;
        }
        const fix = new vscode.CodeAction(
          "Replace with generated UUID",
          vscode.CodeActionKind.QuickFix,
        );
        fix.diagnostics = [diagnostic];
        fix.isPreferred = true;
        fix.command = {
          command: "prairielearn-navigator.addGeneratedUuid",
          title: fix.title,
          arguments: [document.uri, currentValue],
        };
        quickFixes.push(fix);
        continue;
      }

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
