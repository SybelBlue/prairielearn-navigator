import * as path from "node:path";
import * as vscode from "vscode";

export type FileWatcherEvent = { uris: vscode.Uri[] } & (
  | { type: "refreshed" }
  | { type: "added" | "changed" | "removed"; uri: vscode.Uri }
);

type MembershipDelta = {
  sequence: number;
  type: "added" | "removed";
  uri: vscode.Uri;
};

export class FileWatcher {
  private watcher: vscode.FileSystemWatcher;
  private uris = new Map<string, vscode.Uri>();
  private onUpdatedEmitter = new vscode.EventEmitter<FileWatcherEvent>();
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshPromise: Promise<void> | undefined;
  private refreshAgain = false;
  private sequence = 0;
  private membershipDeltas: MembershipDelta[] = [];

  public readonly onUpdated = this.onUpdatedEmitter.event;

  constructor(private readonly globPattern: string) {
    this.watcher = vscode.workspace.createFileSystemWatcher(globPattern);

    this.watcher.onDidCreate((uri) => this.handleCreate(uri));
    this.watcher.onDidDelete((uri) => this.handleDelete(uri));
    this.watcher.onDidChange((uri) => this.handleChange(uri));

    void this.refresh();
  }

  private key(uri: vscode.Uri): string {
    const normalized = path.normalize(uri.fsPath);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  }

  private handleCreate(uri: vscode.Uri) {
    const key = this.key(uri);
    if (this.uris.has(key)) {
      return;
    }
    this.recordMembership("added", uri);
    this.uris.set(key, uri);
    this.onUpdatedEmitter.fire({ type: "added", uri, uris: this.getUris() });
  }

  private handleChange(uri: vscode.Uri) {
    const key = this.key(uri);
    if (!this.uris.has(key)) {
      this.recordMembership("added", uri);
      this.uris.set(key, uri);
    }
    this.onUpdatedEmitter.fire({ type: "changed", uri, uris: this.getUris() });
  }

  private handleDelete(uri: vscode.Uri) {
    this.recordMembership("removed", uri);
    this.uris.delete(this.key(uri));
    this.onUpdatedEmitter.fire({ type: "removed", uri, uris: this.getUris() });
    // A directory deletion may not report every descendant, so reconcile once
    // after a burst rather than rescanning for every individual event.
    this.scheduleRefresh();
  }

  private recordMembership(type: MembershipDelta["type"], uri: vscode.Uri) {
    this.membershipDeltas.push({ sequence: ++this.sequence, type, uri });
  }

  private scheduleRefresh() {
    if (this.refreshPromise) {
      this.refreshAgain = true;
      return;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 10);
  }

  private async refresh(): Promise<void> {
    if (this.refreshPromise) {
      this.refreshAgain = true;
      return this.refreshPromise;
    }

    this.refreshAgain = false;
    const startedAt = this.sequence;
    const refresh = (async () => {
      const foundUris = await vscode.workspace.findFiles(this.globPattern);
      const next = new Map(foundUris.map((uri) => [this.key(uri), uri]));
      const observedThrough = this.sequence;
      for (const delta of this.membershipDeltas) {
        if (delta.sequence <= startedAt || delta.sequence > observedThrough) {
          continue;
        }
        const key = this.key(delta.uri);
        if (delta.type === "added") {
          next.set(key, delta.uri);
        } else {
          next.delete(key);
        }
      }
      this.membershipDeltas = this.membershipDeltas.filter(
        (delta) => delta.sequence > observedThrough,
      );
      this.uris = next;
      this.onUpdatedEmitter.fire({ type: "refreshed", uris: this.getUris() });
    })();
    this.refreshPromise = refresh;
    try {
      await refresh;
    } finally {
      this.refreshPromise = undefined;
      if (this.refreshAgain) {
        this.scheduleRefresh();
      }
    }
  }

  public getUris(): vscode.Uri[] {
    return [...this.uris.values()];
  }

  public dispose() {
    clearTimeout(this.refreshTimer);
    this.watcher.dispose();
    this.onUpdatedEmitter.dispose();
  }
}
