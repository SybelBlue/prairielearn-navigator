import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { QuestionId } from "../common";
import { questionFilePathsFromId } from "../core/questionPaths";
import { CourseCache } from "./courseCache";
import { FileWatcher } from "./filewatcher";

const reTargets = /[\{\}\[\]\|\*\+\\\.\^]/g;
function makeRegexSafe(s: string) {
  return s.replaceAll(reTargets, "\\$&");
}

export class QuestionCache {
  private static regexSafeIds: Map<string, string> = new Map();
  private questionIds: QuestionId[] = [];
  private fileWatcher: FileWatcher;
  private tagMap: Map<string, Set<QuestionId>> = new Map();
  private onUpdatedEmitter = new vscode.EventEmitter<QuestionId[]>();

  public readonly onUpdated = this.onUpdatedEmitter.event;

  constructor(private courseCache: CourseCache) {
    // capture all question changes so that missing server.py/html files trigger
    this.fileWatcher = new FileWatcher("**/questions/**");

    this.fileWatcher.onUpdated((event) => {
      if (event.type === "refreshed") {
        this.rebuildIndex(event.uris);
      } else {
        this.addToIndex(event.uri);
      }
      this.onUpdatedEmitter.fire(this.getQuestionIds());
    });

    this.courseCache.onUpdated(() => {
      this.rebuildIndex(this.fileWatcher.getUris());
      this.onUpdatedEmitter.fire(this.getQuestionIds());
    });
  }

  private rebuildIndex(uris: vscode.Uri[]) {
    this.questionIds = [];
    if (uris.length * 2 < QuestionCache.regexSafeIds.size) {
      this.clear();
    }
    uris.forEach((uri) => this.addToIndex(uri));
  }

  private clear() {
    QuestionCache.regexSafeIds.clear();
    this.tagMap.clear();
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
    const rawData = fs.readFileSync(uri.fsPath, 'utf-8');
    const { tags = [] } = JSON.parse(rawData);
    for (const t of tags) {
      const s = this.tagMap.get(t) ?? new Set();
      s.add(quid);
      this.tagMap.set(t, s);
    }
  }

  public getQuestionIds(): QuestionId[] {
    return [...this.questionIds];
  }

  public getTags(): string[] {
    return [...this.tagMap.keys()];
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

  static getUriFrom(questionId: QuestionId): vscode.Uri {
    return vscode.Uri.file(
      path.join(
        questionId.courseId,
        "questions",
        questionId.localId,
        "info.json"
      )
    );
  }

  static questionFilePathsFromId(questionId: QuestionId) {
    return questionFilePathsFromId(questionId);
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onUpdatedEmitter.dispose();
  }
}
