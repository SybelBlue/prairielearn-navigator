import * as vscode from "vscode";
import * as path from "path";
import { getLocalQuestionIdFromUri, makeRegexSafe, QuestionId } from "./utils";

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
  constructor(public readonly uri: vscode.Uri) {
    this.courseId = path.dirname(path.normalize(uri.fsPath));
    this.pathParts = this.courseId.split(path.sep).length;
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
          return;
        }
        break;
      }
    }
    this.paths.splice(i, 0, path);
  }

  getCourseIdFor(filePath: vscode.Uri | string): string | null {
    const p = path.normalize(
      filePath instanceof vscode.Uri ? filePath.fsPath : filePath
    );
    const out =
      this.paths.find((cjp) => p.startsWith(cjp.courseId))?.courseId ?? null;
    console.log(
      filePath instanceof vscode.Uri ? filePath.fsPath : filePath,
      ">",
      out
    );
    return out;
  }

  getCourseIds(): string[] {
    return this.paths.map((cjp) => cjp.courseId);
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

    this.fileWatcher.onDidCreate(() => this.refresh());
    this.fileWatcher.onDidDelete(() => this.refresh());
    this.fileWatcher.onDidChange(() => this.refresh());

    this.refresh();
  }

  private async refresh() {
    const courseJsons = await vscode.workspace.findFiles("**/infoCourse.json");

    this.courseJsons.clear();
    courseJsons.forEach((uri) => this.courseJsons.push(uri));

    this.onDidChangeEmitter.fire(this.courseJsons.getCourseIds());
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }

  public getCourseIdFor(filePath: vscode.Uri | string): string {
    const out =
      this.courseJsons.getCourseIdFor(filePath) ??
      (filePath instanceof vscode.Uri
        ? vscode.workspace.getWorkspaceFolder(filePath)?.uri.fsPath
        : null) ??
      (filePath instanceof vscode.Uri ? filePath.fsPath : filePath);
    return out;
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

    this.fileWatcher.onDidCreate(() => this.refresh());
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
    for (const instJson of this.courseInstanceJsons) {
      const key = this.courseCache.getCourseIdFor(instJson);
      const valArr = this.instancesByCourseId.get(key);
      if (valArr) {
        valArr.push(instJson);
      } else {
        this.instancesByCourseId.set(key, [instJson]);
      }
    }

    this.onDidChangeEmitter.fire(this.getCourseInstanceJsons());
  }

  public getCourseInstanceJsons(): vscode.Uri[] {
    return [...this.courseInstanceJsons];
  }

  public getCourseInstanceFor(courseId: string) {
    return [...(this.instancesByCourseId.get(courseId) ?? [])];
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }
}

export class QuestionIdCache {
  private static regexSafeIds: Map<string, string> = new Map();
  private questionIds: QuestionId[] = [];
  private fileWatcher: vscode.FileSystemWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<QuestionId[]>();

  // Event that providers can subscribe to
  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private courseCache: CourseCache) {
    this.fileWatcher =
      vscode.workspace.createFileSystemWatcher("**/questions/**");

    this.fileWatcher.onDidCreate(() => this.refresh());
    this.fileWatcher.onDidDelete(() => this.refresh());
    this.fileWatcher.onDidChange(() => this.refresh());

    this.courseCache.onDidChange(() => this.refresh());

    this.refresh();
  }

  private async refresh() {
    const questionInfoJsons = await vscode.workspace.findFiles(
      "**/questions/**/info.json"
    );
    this.questionIds = questionInfoJsons.map((uri) =>
      this.courseCache.getQuestionIdFor(uri)
    );
    for (const id of this.questionIds) {
      if (!QuestionIdCache.regexSafeIds.has(id.localId)) {
        QuestionIdCache.regexSafeIds.set(id.localId, makeRegexSafe(id.localId));
      }
    }
    this.onDidChangeEmitter.fire(this.getQuestionIds());
  }

  public getQuestionIds(): QuestionId[] {
    return [...this.questionIds];
  }

  getRegexSafeQuestionIds(): string[] {
    return this.questionIds.map(
      (id) =>
        QuestionIdCache.regexSafeIds.get(id.localId) ||
        makeRegexSafe(id.localId)
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
        const newLocation = new vscode.Location(
          doc.uri,
          new vscode.Range(
            doc.positionAt(matchEnd - (matchedId.length + 1)),
            doc.positionAt(matchEnd - 1)
          )
        );
        const value = this.questionUses.get(matchedId);
        if (value) {
          value.push(newLocation);
        } else {
          this.questionUses.set(matchedId, [newLocation]);
        }
      }
    }

    this.onDidChangeEmitter.fire(this.getAssessmentJsons());
  }

  public getQuestionUses(questionId: string): vscode.Location[] {
    return [...(this.questionUses.get(questionId) || [])];
  }

  public getAssessmentJsons() {
    return [...this.assessmentJsons];
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }
}
