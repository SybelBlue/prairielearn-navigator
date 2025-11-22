import * as path from "path";
import * as vscode from "vscode";
import { QuestionId, ScopedId } from "../common";
import { CourseIdManager } from "./courseIdManager";
import { FileWatcher } from "./filewatcher";

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

  getDisplayNameFor(courseId: string) {
    return this.courseJsons.getDisplayNameFor(courseId);
  }

  getCourseIdFor(filePath: vscode.Uri): string {
    return this.courseJsons.getCourseIdFor(filePath);
  }

  getScopedIdFor(filePath: vscode.Uri): ScopedId {
    return this.courseJsons.getScopedIdFor(filePath);
  }

  getQuestionIdFor(questionUri: vscode.Uri): QuestionId {
    const courseId = this.getCourseIdFor(questionUri);
    const pathParts = path.normalize(questionUri.fsPath).split(path.sep);
    const localId = pathParts
      .slice(pathParts.indexOf("questions") + 1, -1)
      .join(path.sep);
    return { courseId, localId };
  }

  getUriFrom(courseId: string) {
    return this.fileWatcher
      .getUris()
      .find((uri) => uri.fsPath.startsWith(courseId));
  }

  getCourseIds() {
    return this.courseJsons.getIds();
  }
}
