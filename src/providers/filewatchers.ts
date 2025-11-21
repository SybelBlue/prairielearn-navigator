import * as vscode from "vscode";
import * as path from "path";
import {
  getLocalQuestionIdFromUri,
  getQuestionDirFromId,
  makeRegexSafe,
  QuestionId,
} from "./utils";

/*
 * Assumed structure:
 * $workspaceRoot([/.../course])
 * | "infoCourse.json"
 * | "courseInstances"/...(/instance)
 * | | "infoCourseInstance.json"
 * | | (.../assessment)
 * | | | "infoAssessment.json"
 * | "questions"(/.../... -> question_id)
 * | | "info.json"
 * |
 */
export type FileWatcherEvent = { uris: vscode.Uri[] } & (
  | { type: "refreshed" }
  | { type: "added"; uri: vscode.Uri }
);

class FileWatcher {
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

class CourseJsonPath {
  public readonly pathParts: number;
  public readonly courseId: string;
  public readonly displayName: string;
  constructor(public readonly uri: vscode.Uri) {
    this.courseId = path.dirname(path.normalize(uri.fsPath));
    this.pathParts = this.courseId.split(path.sep).length;

    const wsPath = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
    this.displayName = this.courseId.slice(
      0,
      wsPath === undefined ? -1 : wsPath.length
    );
  }
}

class CourseJsonPaths {
  private paths: CourseJsonPath[] = [];

  getPaths(): CourseJsonPath[] {
    return [...this.paths];
  }

  clear() {
    this.paths = [];
  }

  push(uri: vscode.Uri) {
    const path = new CourseJsonPath(uri);
    let i;
    for (i = 0; i < this.paths.length; i++) {
      const p: CourseJsonPath = this.paths[i];
      if (p.pathParts <= path.pathParts) {
        if (p.uri.fsPath === path.uri.fsPath) {
          return path;
        }
        break;
      }
    }
    this.paths.splice(i, 0, path);
    return path;
  }

  getCourseIdFor(filePath: vscode.Uri | string): string | null {
    const p = path.normalize(
      filePath instanceof vscode.Uri ? filePath.fsPath : filePath
    );
    return (
      this.paths.find((cjp) => p.startsWith(cjp.courseId))?.courseId ?? null
    );
  }

  getCourseIds(): string[] {
    return this.paths.map((cjp) => cjp.courseId);
  }

  getDisplayNameFor(courseId: string) {
    return this.paths.find((cjp) => cjp.courseId === courseId)?.displayName;
  }
}

export class CourseCache {
  private courseJsons: CourseJsonPaths = new CourseJsonPaths();
  private fileWatcher: FileWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<string[]>();

  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor() {
    this.fileWatcher = new FileWatcher("**/infoCourse.json");

    this.fileWatcher.onDidChange((event) => {
      if (event.type === "refreshed") {
        this.courseJsons.clear();
        event.uris.forEach((uri) => this.courseJsons.push(uri));
      } else {
        this.courseJsons.push(event.uri);
      }
      this.onDidChangeEmitter.fire(this.courseJsons.getCourseIds());
    });
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }

  public getDisplayNameFor(courseId: string) {
    return this.courseJsons.getDisplayNameFor(courseId);
  }

  public getCourseIdFor(filePath: vscode.Uri | string): string {
    return (
      this.courseJsons.getCourseIdFor(filePath) ??
      (filePath instanceof vscode.Uri
        ? vscode.workspace.getWorkspaceFolder(filePath)?.uri.fsPath
        : null) ??
      (filePath instanceof vscode.Uri ? filePath.fsPath : filePath)
    );
  }

  public getQuestionIdFor(questionUri: vscode.Uri): QuestionId {
    return {
      courseId: this.getCourseIdFor(questionUri),
      localId: getLocalQuestionIdFromUri(questionUri),
    };
  }
}

export class CourseInstanceCache {
  private instancesByCourseId: Map<string, vscode.Uri[]> = new Map();
  private fileWatcher: FileWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri[]>();

  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private courseCache: CourseCache) {
    this.fileWatcher = new FileWatcher("**/infoCourseInstance.json");

    this.fileWatcher.onDidChange((event) => {
      if (event.type === "refreshed") {
        this.rebuildIndex(event.uris);
      } else {
        this.addToIndex(event.uri);
      }
      this.onDidChangeEmitter.fire(this.fileWatcher.getUris());
    });

    this.courseCache.onDidChange(() => {
      this.rebuildIndex(this.fileWatcher.getUris());
      this.onDidChangeEmitter.fire(this.fileWatcher.getUris());
    });
  }

  private rebuildIndex(uris: vscode.Uri[]) {
    this.instancesByCourseId.clear();
    uris.forEach((uri) => this.addToIndex(uri));
  }

  private addToIndex(uri: vscode.Uri) {
    const key = this.courseCache.getCourseIdFor(uri);
    const valArr = this.instancesByCourseId.get(key);
    if (valArr) {
      valArr.push(uri);
    } else {
      this.instancesByCourseId.set(key, [uri]);
    }
  }

  public getCourseInstanceJsons(): vscode.Uri[] {
    return this.fileWatcher.getUris();
  }

  public getCourseInstancesFor(courseId: string) {
    return [...(this.instancesByCourseId.get(courseId) ?? [])];
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }
}

export class QuestionCache {
  private static regexSafeIds: Map<string, string> = new Map();
  private questionIds: QuestionId[] = [];
  private fileWatcher: FileWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<QuestionId[]>();

  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private courseCache: CourseCache) {
    // capture all question changes so that missing server.py/html files trigger
    this.fileWatcher = new FileWatcher("**/questions/**");

    this.fileWatcher.onDidChange((event) => {
      if (event.type === "refreshed") {
        this.rebuildIndex(event.uris);
      } else {
        this.addToIndex(event.uri);
      }
      this.onDidChangeEmitter.fire(this.getQuestionIds());
    });

    this.courseCache.onDidChange(() => {
      this.rebuildIndex(this.fileWatcher.getUris());
      this.onDidChangeEmitter.fire(this.getQuestionIds());
    });
  }

  private rebuildIndex(uris: vscode.Uri[]) {
    this.questionIds = [];
    if (uris.length * 2 < QuestionCache.regexSafeIds.size) {
      QuestionCache.regexSafeIds.clear();
    }
    uris.forEach((uri) => this.addToIndex(uri));
  }

  private addToIndex(uri: vscode.Uri) {
    if (path.basename(uri.fsPath) !== "info.json") {
      return;
    }
    const quid = this.courseCache.getQuestionIdFor(uri);
    this.questionIds.push(quid);
    if (!QuestionCache.regexSafeIds.has(quid.localId)) {
      QuestionCache.regexSafeIds.set(quid.localId, makeRegexSafe(quid.localId));
    }
  }

  public getQuestionIds(): QuestionId[] {
    return [...this.questionIds];
  }

  getCourseRegexSafeQuestionIds(courseId: string): string[] {
    return this.questionIds
      .filter((id) => id.courseId === courseId)
      .map(
        (id) =>
          QuestionCache.regexSafeIds.get(id.localId) ||
          makeRegexSafe(id.localId)
      );
  }

  getAllRegexSafeQuestionIds(): string[] {
    return this.questionIds.map(
      (id) =>
        QuestionCache.regexSafeIds.get(id.localId) || makeRegexSafe(id.localId)
    );
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }
}

export class AssessmentCache {
  private questionUses: Map<string, vscode.Location[]> = new Map();
  private fileWatcher: FileWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri[]>();

  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(
    private courseCache: CourseCache,
    private questionCache: QuestionCache
  ) {
    this.fileWatcher = new FileWatcher("**/assessments/**/infoAssessment.json");

    this.fileWatcher.onDidChange((event) => {
      if (event.type === "refreshed") {
        this.rebuildIndex(event.uris);
      } else {
        this.addToIndex(event.uri);
      }
      this.onDidChangeEmitter.fire(this.fileWatcher.getUris());
    });

    this.questionCache.onDidChange(() => {
      this.rebuildIndex(this.fileWatcher.getUris());
      this.onDidChangeEmitter.fire(this.fileWatcher.getUris());
    });
  }

  private async rebuildIndex(uris: vscode.Uri[]) {
    this.questionUses.clear();
    await Promise.all(uris.map((uri) => this.addToIndex(uri)));
  }

  private async addToIndex(uri: vscode.Uri) {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (!doc) {
      return;
    }
    const courseId = this.courseCache.getCourseIdFor(uri);

    const questionIds = this.questionCache
      .getCourseRegexSafeQuestionIds(courseId)
      .join("|");
    const re = RegExp(`"id"\\s*:[\\s\\n]*"(${questionIds})"`, "gm");
    const docText = doc.getText();
    let match;
    while ((match = re.exec(docText))) {
      const matchEnd = match.index + match[0].length;
      const localId = match[1];
      const newLocation = new vscode.Location(
        doc.uri,
        new vscode.Range(
          doc.positionAt(matchEnd - (localId.length + 1)),
          doc.positionAt(matchEnd - 1)
        )
      );
      const quid = { localId, courseId };
      const key = getQuestionDirFromId(quid);
      const value = this.questionUses.get(key);
      if (value) {
        value.push(newLocation);
      } else {
        this.questionUses.set(key, [newLocation]);
      }
    }
  }

  public getQuestionUses(questionId: QuestionId): vscode.Location[] {
    return [...(this.questionUses.get(getQuestionDirFromId(questionId)) || [])];
  }

  public getAssessmentJsons() {
    return this.fileWatcher.getUris();
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }
}
