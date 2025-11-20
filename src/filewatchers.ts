import * as vscode from "vscode";
import { getQuestionIdFromUri } from "./utils";

export class QuestionIdCache {
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
    this.onDidChangeEmitter.fire(this.questionIds);
  }

  public getQuestionIds(): string[] {
    return [...this.questionIds];
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }
}
