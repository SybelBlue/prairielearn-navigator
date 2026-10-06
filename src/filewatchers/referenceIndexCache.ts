import * as fs from "fs";
import * as vscode from "vscode";
import { versionDate } from "../core/plVersion";
import { indexCourseAsync, ReferenceIndex, Use } from "../core/referenceIndex";
import { ConfigProvider } from "../providers/config";
import { CourseCache } from "./courseCache";

const debounceMs = 300;

export interface ReferencesChanged {
  courseRoot: string;
  /** The path that was created, edited, or deleted. */
  changed: string;
  /** Files whose references point at or into `changed`. */
  affected: string[];
}

/**
 * Keeps a ReferenceIndex per course, built on first use and then updated
 * one file at a time from file system events and open editors.
 */
export class ReferenceIndexCache {
  private indexes = new Map<string, ReferenceIndex>();
  /** Courses being indexed, with the paths that changed meanwhile. */
  private building = new Map<string, { done: Promise<ReferenceIndex>; changed: Set<string> }>();
  private timers = new Map<string, NodeJS.Timeout>();
  private onChangedEmitter = new vscode.EventEmitter<ReferencesChanged>();
  private disposables: vscode.Disposable[] = [];

  public readonly onChanged = this.onChangedEmitter.event;

  constructor(
    private courseCache: CourseCache,
    private configs: ConfigProvider
  ) {
    // Targets can be any file (images, css, ...), so watch everything
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    this.disposables.push(
      watcher,
      watcher.onDidCreate((uri) => this.onFileEvent(uri)),
      watcher.onDidChange((uri) => this.onFileEvent(uri)),
      watcher.onDidDelete((uri) => this.onFileEvent(uri)),
      vscode.workspace.onDidChangeTextDocument((e) => this.scheduleUpdate(e.document)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.onFileEvent(doc.uri)),
      configs.onChanged(() => {
        this.indexes.clear();
        this.building.clear();
      }),
      { dispose: () => this.timers.forEach((t) => clearTimeout(t)) }
    );
  }

  /**
   * The index for the course containing `uri`, or undefined if it is not in
   * a course or is still being built (which this starts). `onChanged` fires
   * when a build finishes.
   */
  indexFor(uri: vscode.Uri): ReferenceIndex | undefined {
    const courseRoot = this.courseCache.getCourseIdFor(uri);
    if (!courseRoot) {
      return undefined;
    }
    const index = this.indexes.get(courseRoot);
    if (!index) {
      this.build(courseRoot);
    }
    return index;
  }

  /** The index for the course containing `uri`, waiting for it to be built. */
  async whenIndexed(uri: vscode.Uri): Promise<ReferenceIndex | undefined> {
    const courseRoot = this.courseCache.getCourseIdFor(uri);
    if (!courseRoot) {
      return undefined;
    }
    return this.indexes.get(courseRoot) ?? this.build(courseRoot);
  }

  private build(courseRoot: string): Promise<ReferenceIndex> {
    const pending = this.building.get(courseRoot);
    if (pending) {
      return pending.done;
    }
    const changed = new Set<string>();
    const started = Date.now();
    const plDate = versionDate(this.configs.configFor(courseRoot).plVersion);
    const done = indexCourseAsync(courseRoot, plDate).then((index) => {
      if (this.building.get(courseRoot)?.done !== done) {
        return index; // superseded by a config change
      }
      this.building.delete(courseRoot);
      this.indexes.set(courseRoot, index);
      // Unsaved editors win over the disk, then replay changes made meanwhile
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.isDirty && doc.uri.fsPath.startsWith(courseRoot) && index.holdsReferences(doc.uri.fsPath)) {
          index.update(doc.uri.fsPath, doc.getText());
        }
      }
      changed.forEach((file) => this.refresh(vscode.Uri.file(file), undefined));
      console.info(`prairielearn -- indexed references in ${courseRoot} in ${Date.now() - started}ms`);
      this.onChangedEmitter.fire({ courseRoot, changed: courseRoot, affected: index.files() });
      return index;
    });
    this.building.set(courseRoot, { done, changed });
    return done;
  }

  /** Uses of `uri`; empty while its course is still being indexed. */
  usesOf(uri: vscode.Uri): Use[] {
    return this.indexFor(uri)?.usesOf(uri.fsPath) ?? [];
  }

  private scheduleUpdate(document: vscode.TextDocument) {
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.refresh(document.uri, document.getText());
      }, debounceMs)
    );
  }

  private onFileEvent(uri: vscode.Uri) {
    if (uri.scheme !== "file") {
      return;
    }
    const open = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === uri.toString() && !d.isClosed && d.isDirty
    );
    // Without unsaved text, refresh reads the disk, and only if needed
    this.refresh(uri, open?.getText());
  }

  private refresh(uri: vscode.Uri, text: string | undefined) {
    const courseRoot = this.courseCache.getCourseIdFor(uri);
    if (!courseRoot) {
      return;
    }
    // Only maintain indexes that something has asked for
    const index = this.indexes.get(courseRoot);
    if (!index) {
      this.building.get(courseRoot)?.changed.add(uri.fsPath);
      return;
    }
    const file = uri.fsPath;
    if (index.holdsReferences(file)) {
      if (text !== undefined) {
        index.update(file, text);
      } else if (fs.existsSync(file)) {
        index.update(file, fs.readFileSync(file, "utf-8"));
      } else {
        index.remove(file);
      }
    }
    const affected = index.filesAffectedBy(file);
    if (affected.length > 0) {
      this.onChangedEmitter.fire({ courseRoot, changed: file, affected });
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.onChangedEmitter.dispose();
  }
}
