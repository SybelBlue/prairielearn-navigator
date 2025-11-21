import * as vscode from "vscode";
import { CourseCache } from "./courseCache";
import { FileWatcher } from "./filewatcher";

export class CourseInstanceCache {
  private instancesByCourseId: Map<string, vscode.Uri[]> = new Map();
  private fileWatcher: FileWatcher;
  private onUpdatedEmitter = new vscode.EventEmitter<vscode.Uri[]>();

  public readonly onUpdated = this.onUpdatedEmitter.event;

  constructor(private courseCache: CourseCache) {
    this.fileWatcher = new FileWatcher("**/infoCourseInstance.json");

    this.fileWatcher.onUpdated((event) => {
      if (event.type === "refreshed") {
        this.rebuildIndex(event.uris);
      } else {
        this.addToIndex(event.uri);
      }
      this.onUpdatedEmitter.fire(this.fileWatcher.getUris());
    });

    this.courseCache.onUpdated(() => {
      this.rebuildIndex(this.fileWatcher.getUris());
      this.onUpdatedEmitter.fire(this.fileWatcher.getUris());
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
    this.onUpdatedEmitter.dispose();
  }
}
