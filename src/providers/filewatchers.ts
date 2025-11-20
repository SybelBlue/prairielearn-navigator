import * as vscode from "vscode";
import { getQuestionIdFromUri, makeRegexSafe } from "./utils";

export class QuestionIdCache {
  private static safeIds: Map<string, string> = new Map();
  private questionIds: string[] = [];
  private fileWatcher: vscode.FileSystemWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<string[]>();

  // Event that providers can subscribe to
  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor() {
    this.fileWatcher =
      vscode.workspace.createFileSystemWatcher("**/questions/**");

    this.fileWatcher.onDidCreate(() => this.refresh());
    this.fileWatcher.onDidDelete(() => this.refresh());
    this.fileWatcher.onDidChange(() => this.refresh());

    this.refresh();
  }

  private async refresh() {
    const questionInfoJsons = await vscode.workspace.findFiles(
      "**/questions/**/info.json"
    );
    this.questionIds = questionInfoJsons.map((uri) =>
      getQuestionIdFromUri(uri)
    );
    for (const id of this.questionIds) {
      if (!QuestionIdCache.safeIds.has(id)) {
        QuestionIdCache.safeIds.set(id, makeRegexSafe(id));
      }
    }
    this.onDidChangeEmitter.fire(this.questionIds);
  }

  public getQuestionIds(): string[] {
    return [...this.questionIds];
  }

  getRegexSafeQuestionIds(): string[] {
    return this.questionIds.map(
      (id) => QuestionIdCache.safeIds.get(id) || makeRegexSafe(id)
    );
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }
}

export class AssessmentCache {
  private assessmentJsons: vscode.Uri[] = [];
  private questionUses: Map<string, vscode.Location> = new Map();
  private fileWatcher: vscode.FileSystemWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri[]>();

  // Event that providers can subscribe to
  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private questionCache: QuestionIdCache) {
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      "**/assessments/**/infoAssessment.json"
    );

    this.fileWatcher.onDidCreate(() => this.refresh());
    this.fileWatcher.onDidDelete(() => this.refresh());
    this.fileWatcher.onDidChange(() => this.refresh());

    questionCache.onDidChange(() => this.refresh());

    this.refresh();
  }

  private async refresh() {
    this.assessmentJsons = await vscode.workspace.findFiles(
      "**/assessments/**/infoAssessment.json"
    );

    this.questionUses.clear();
    const questionIds = this.questionCache.getRegexSafeQuestionIds().join("|");
    const re = new RegExp(`"id"\\s*:[\\s\\n]*"(${questionIds})"`, "gm");

    for (const uri of this.assessmentJsons) {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (!doc) {
        return [];
      }
      const docText = doc.getText();
      let match;
      while ((match = re.exec(docText))) {
        const matchEnd = match.index + match[0].length;
        const matchedId = match[1];
        this.questionUses.set(
          matchedId,
          new vscode.Location(
            doc.uri,
            new vscode.Range(
              doc.positionAt(matchEnd - (matchedId.length + 1)),
              doc.positionAt(matchEnd - 1)
            )
          )
        );
      }
    }

    this.onDidChangeEmitter.fire(this.getAssessmentJsons());
  }

  public getQuestionUses() {
    return [...this.questionUses];
  }

  public getAssessmentJsons() {
    return [...this.assessmentJsons];
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }
}
