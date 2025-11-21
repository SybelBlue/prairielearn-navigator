import * as vscode from "vscode";

export type FileWatcherEvent = { uris: vscode.Uri[] } & (
  | { type: "refreshed" }
  | { type: "added"; uri: vscode.Uri }
);

export class FileWatcher {
  private watcher: vscode.FileSystemWatcher;
  private uris: vscode.Uri[] = [];
  private onDidChangeEmitter = new vscode.EventEmitter<FileWatcherEvent>();

  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly globPattern: string) {
    this.watcher = vscode.workspace.createFileSystemWatcher(globPattern);

    this.watcher.onDidCreate((uri) => this.handleCreate(uri));
    this.watcher.onDidDelete(() => this.refresh());
    this.watcher.onDidChange(() => this.refresh());

    this.refresh();
  }

  private async refresh() {
    const foundUris = await vscode.workspace.findFiles(this.globPattern);
    this.uris = foundUris;
    this.onDidChangeEmitter.fire({ type: "refreshed", uris: this.getUris() });
  }

  private handleCreate(uri: vscode.Uri) {
    this.uris.push(uri);
    this.onDidChangeEmitter.fire({ type: "added", uri, uris: this.getUris() });
  }

  public getUris(): vscode.Uri[] {
    return [...this.uris];
  }

  public dispose() {
    this.watcher.dispose();
    this.onDidChangeEmitter.dispose();
  }
}
