import * as path from "path";
import * as vscode from "vscode";

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

export class CourseIdManager {
  private paths: CourseJsonPath[] = [];

  getPaths(): CourseJsonPath[] {
    return [...this.paths];
  }

  clear() {
    this.paths = [];
  }

  createId(uri: vscode.Uri) {
    const path = new CourseJsonPath(uri);
    let i;
    for (i = 0; i < this.paths.length; i++) {
      const p: CourseJsonPath = this.paths[i];
      if (p.pathParts <= path.pathParts) {
        if (p.uri.fsPath === path.uri.fsPath) {
          return path.courseId;
        }
        break;
      }
    }
    this.paths.splice(i, 0, path);
    return path.courseId;
  }

  removeId(courseId: string) {
    this.paths = this.paths.filter((cjp) => cjp.courseId !== courseId);
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
