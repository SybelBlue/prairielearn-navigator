import * as path from "path";
import * as vscode from "vscode";
import { getLocalQuestionIdFromUri, QuestionId } from "../utils";
import { FileWatcher } from "./filewatcher";

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
  private onUpdatedEmitter = new vscode.EventEmitter<string[]>();

  public readonly onUpdated = this.onUpdatedEmitter.event;

  constructor() {
    this.fileWatcher = new FileWatcher("**/infoCourse.json");

    this.fileWatcher.onUpdated((event) => {
      if (event.type === "refreshed") {
        this.courseJsons.clear();
        event.uris.forEach((uri) => this.courseJsons.push(uri));
      } else {
        this.courseJsons.push(event.uri);
      }
      this.onUpdatedEmitter.fire(this.courseJsons.getCourseIds());
    });
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onUpdatedEmitter.dispose();
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
