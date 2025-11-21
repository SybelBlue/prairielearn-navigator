import * as path from "path";
import * as vscode from "vscode";
import { makeRegexSafe, QuestionId } from "../utils";
import { CourseCache } from "./courseCache";
import { FileWatcher } from "./filewatcher";

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
