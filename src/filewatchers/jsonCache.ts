import * as vscode from "vscode";
import * as path from "path";
import { CourseIdManager } from "./courseIdManager";

type LocalId = string;

type CourseId = string;
type ScopedId = { courseId: CourseId; localId: LocalId };
type InstanceId = ScopedId;
type AssessmentId = ScopedId & { instanceId: LocalId };
type QuestionId = ScopedId;
type JsonType =
  | { type: "course"; uri: vscode.Uri }
  | ({ type: "instance" } & InstanceId)
  | ({ type: "question" } & QuestionId)
  | ({ type: "assessment" } & AssessmentId);

type FileUpdateType = "create" | "delete" | "change";

type AssessmentReference = { questionId: string; location: vscode.Location };
type AssessmentData = Map<LocalId, AssessmentReference[]>;
type InstanceData = Map<LocalId, AssessmentData[]>;
type CourseData = {
  instances: Map<LocalId, InstanceData>;
  questions: Set<LocalId>;
};

type JsonRegistry = {
  courses: Map<CourseId, CourseData>;
};

export class JsonCache {
  private watcher: vscode.FileSystemWatcher;
  private courseIdManager: CourseIdManager;

  private jsons: JsonRegistry;

  constructor() {
    this.courseIdManager = new CourseIdManager();
    this.jsons = { courses: new Map() };

    this.watcher = vscode.workspace.createFileSystemWatcher("**/*.json");

    this.watcher.onDidCreate((uri) => this.update("create", uri));
    this.watcher.onDidDelete((uri) => this.update("delete", uri));
    this.watcher.onDidChange((uri) => this.update("change", uri));

    this.init();
  }

  async init() {
    const js = await vscode.workspace.findFiles("**/*.json");
    js.forEach((uri) => this.update("create", uri));
  }

  private async update(updateType: FileUpdateType, uri: vscode.Uri) {
    // fix me
    const data = this.classifyUri(uri);
    if (data === null) {
      return;
    }

    if (data.type === "course") {
      if (updateType === "create") {
        const id = this.courseIdManager.createId(uri);
        this.jsons.courses.set(id, {
          instances: new Map(),
          questions: new Set(),
        });
        return;
      }
      if (updateType === "delete") {
        const id = this.courseIdManager.getCourseIdFor(uri);
        if (id !== null) {
          this.courseIdManager.removeId(id);
          this.jsons.courses.delete(id);
        }
        return;
      }
      // do nothing on changes
      return;
    }

    if (data.type === "question") {
      const { courseId, localId } = data;
      const questionSet = this.jsons.courses.get(courseId)!.questions;
      if (updateType === "create") {
        questionSet.add(localId);
        return;
      }
      if (updateType === "delete") {
        questionSet.delete(localId);
        return;
      }
      // do nothing on changes
      return;
    }

    if (data.type === "instance") {
      const { courseId, localId } = data;
      const instanceMap = this.jsons.courses.get(courseId)!.instances;
      if (updateType === "create") {
        instanceMap.set(localId, new Map());
        return;
      }
      if (updateType === "delete") {
        instanceMap.delete(localId);
        return;
      }
      // do nothing on changes
      return;
    }

    const { courseId, localId, instanceId } = data;
    const assessmentMap = this.jsons.courses
      .get(courseId)!
      .instances.get(instanceId)!;
    if (updateType === "create") {
      assessmentMap.set(localId, []);
      return;
    }
    if (updateType === "delete") {
      assessmentMap.delete(localId);
      return;
    }
    if (updateType === "change") {
      assessmentMap.set(localId, this.computeAssessmentData(data));
      return;
    }
    return;
  }

  computeAssessmentData(
    data: { type: "assessment" } & ScopedId & { instanceId: LocalId }
  ): AssessmentData[] {
    return []; // todo: fix me.
  }

  classifyUri(uri: vscode.Uri): JsonType | null {
    const fsPath = uri.fsPath;
    const baseName = path.basename(fsPath);
    const courseId = this.courseIdManager.getCourseIdFor(uri);
    if (courseId === null) {
      return null;
    }
    if (baseName === "infoCourse.json") {
      return {
        type: "course",
        uri,
      };
    }
    if (baseName === "infoCourseInstance.json") {
      const instanceLocalId = "null";
      return {
        type: "instance",
        courseId,
        localId: instanceLocalId,
      };
    }
    if (baseName === "infoAssessment.json") {
      const assessmentLocalId = "null";
      return {
        type: "assessment",
        courseId,
        localId: assessmentLocalId,
        instanceId: "null",
      };
    }
    if (baseName === "info.json") {
      const questionLocalId = "null";
      return {
        type: "question",
        courseId,
        localId: questionLocalId,
      };
    }
    return null;
  }

  public dispose() {
    this.watcher.dispose();
  }
}
