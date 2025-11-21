import * as vscode from "vscode";
import { getLocalQuestionIdFromUri, QuestionId } from "../utils";
import { FileWatcher } from "./filewatcher";
import { CourseIdManager } from "./courseIdManager";

export class CourseCache {
  private courseJsons: CourseIdManager = new CourseIdManager();
  private fileWatcher: FileWatcher;
  private onUpdatedEmitter = new vscode.EventEmitter<string[]>();

  public readonly onUpdated = this.onUpdatedEmitter.event;

  constructor() {
    this.fileWatcher = new FileWatcher("**/infoCourse.json");

    this.fileWatcher.onUpdated((event) => {
      if (event.type === "refreshed") {
        this.courseJsons.clear();
        event.uris.forEach((uri) => this.courseJsons.createId(uri));
      } else {
        this.courseJsons.createId(event.uri);
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
