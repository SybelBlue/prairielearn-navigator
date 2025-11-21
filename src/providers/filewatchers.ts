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
  private fileWatcher: vscode.FileSystemWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<string[]>();

  // Event that providers can subscribe to
  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor() {
    this.fileWatcher =
      vscode.workspace.createFileSystemWatcher("**/infoCourse.json");

    this.fileWatcher.onDidCreate((uri) => this.addJson(uri));
    this.fileWatcher.onDidDelete(() => this.refresh());
    this.fileWatcher.onDidChange(() => this.refresh());

    this.refresh();
  }

  private async refresh() {
    const courseJsons = await vscode.workspace.findFiles("**/infoCourse.json");

    this.courseJsons.clear();
    courseJsons.forEach((uri) => this.addJson(uri, true));

    this.emit();
  }

  private addJson(uri: vscode.Uri, skipEmit?: boolean) {
    this.courseJsons.push(uri);
    if (!skipEmit) {
      this.emit();
    }
  }

  private emit() {
    this.onDidChangeEmitter.fire(this.courseJsons.getCourseIds());
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
  private courseInstanceJsons: vscode.Uri[] = [];
  private instancesByCourseId: Map<string, vscode.Uri[]> = new Map();
  private fileWatcher: vscode.FileSystemWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri[]>();

  // Event that providers can subscribe to
  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private courseCache: CourseCache) {
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      "**/infoCourseInstance.json"
    );

    this.fileWatcher.onDidCreate((uri) => this.addJson(uri));
    this.fileWatcher.onDidDelete(() => this.refresh());
    this.fileWatcher.onDidChange(() => this.refresh());

    this.courseCache.onDidChange(() => this.refresh());

    this.refresh();
  }

  private async refresh() {
    this.courseInstanceJsons = await vscode.workspace.findFiles(
      "**/infoCourseInstance.json"
    );

    this.instancesByCourseId.clear();
    this.courseInstanceJsons.forEach((cij) => this.addJson(cij, true));

    this.emit();
  }

  private addJson(uri: vscode.Uri, skipEmit?: boolean) {
    const key = this.courseCache.getCourseIdFor(uri);
    const valArr = this.instancesByCourseId.get(key);
    if (valArr) {
      valArr.push(uri);
    } else {
      this.instancesByCourseId.set(key, [uri]);
    }
    if (!skipEmit) {
      this.emit();
    }
  }

  private emit() {
    this.onDidChangeEmitter.fire(this.getCourseInstanceJsons());
  }

  public getCourseInstanceJsons(): vscode.Uri[] {
    return [...this.courseInstanceJsons];
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
  private fileWatcher: vscode.FileSystemWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<QuestionId[]>();

  // Event that providers can subscribe to
  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private courseCache: CourseCache) {
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      "**/questions/**/info.json"
    );

    this.fileWatcher.onDidCreate((uri) => this.addJson(uri));
    this.fileWatcher.onDidDelete(() => this.refresh());
    this.fileWatcher.onDidChange(() => this.refresh());

    this.courseCache.onDidChange(() => this.refresh());

    this.refresh();
  }

  private async refresh() {
    const questionInfoJsons = await vscode.workspace.findFiles(
      "**/questions/**/info.json"
    );
    this.questionIds = [];
    questionInfoJsons.forEach((uri) => this.addJson(uri, true));
    this.emit();
  }

  private addJson(uri: vscode.Uri, skipEmit?: boolean) {
    const quid = this.courseCache.getQuestionIdFor(uri);
    this.questionIds.push(quid);
    if (!QuestionCache.regexSafeIds.has(quid.localId)) {
      QuestionCache.regexSafeIds.set(quid.localId, makeRegexSafe(quid.localId));
    }
    if (!skipEmit) {
      this.emit();
    }
  }

  private emit() {
    this.onDidChangeEmitter.fire(this.getQuestionIds());
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
  private assessmentJsons: vscode.Uri[] = [];
  private questionUses: Map<string, vscode.Location[]> = new Map();
  private fileWatcher: vscode.FileSystemWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri[]>();

  // Event that providers can subscribe to
  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(
    private courseCache: CourseCache,
    private questionCache: QuestionCache
  ) {
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      "**/assessments/**/infoAssessment.json"
    );

    this.fileWatcher.onDidCreate((uri) => this.addJson(uri));
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
    this.assessmentJsons.forEach((uri) => this.addJson(uri, true));

    this.emit();
  }

  private async addJson(uri: vscode.Uri, skipEmit?: boolean) {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (!doc) {
      return [];
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

    if (!skipEmit) {
      this.emit();
    }
  }

  private emit() {
    this.onDidChangeEmitter.fire(this.getAssessmentJsons());
  }

  public getQuestionUses(questionId: QuestionId): vscode.Location[] {
    return [...(this.questionUses.get(getQuestionDirFromId(questionId)) || [])];
  }

  public getAssessmentJsons() {
    return [...this.assessmentJsons];
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }
}
