import * as path from "path";
import * as vscode from "vscode";
import { CourseCache } from "./courseCache";
import { FileWatcher } from "./filewatcher";
import { CourseId, InstanceId, LocalId } from "../utils";

export class CourseInstanceCache {
  private readonly instancesByCourseId: Map<CourseId, LocalId[]> = new Map();
  private readonly fileWatcher: FileWatcher;
  private readonly onUpdatedEmitter = new vscode.EventEmitter<vscode.Uri[]>();

  public readonly onUpdated = this.onUpdatedEmitter.event;

  constructor(private readonly courseCache: CourseCache) {
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
    const { courseId, localId } = this.getCourseInstanceIdFor(uri);
    const valArr = this.instancesByCourseId.get(courseId);
    if (valArr) {
      valArr.push(localId);
    } else {
      this.instancesByCourseId.set(courseId, [localId]);
    }
  }

  getCourseInstanceIdFor(instanceUri: vscode.Uri): InstanceId {
    const { courseId, localId } = this.courseCache.getScopedIdFor(instanceUri);
    return {
      courseId,
      localId: path.join(...localId.split(path.sep).slice(1)),
    };
  }

  getCourseInstancesFor(courseId: string): InstanceId[] {
    return (this.instancesByCourseId.get(courseId) ?? []).map((localId) => ({
      courseId,
      localId,
    }));
  }

  getCourseInstanceJsons(): vscode.Uri[] {
    return [...this.fileWatcher.getUris()];
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onUpdatedEmitter.dispose();
  }
}
