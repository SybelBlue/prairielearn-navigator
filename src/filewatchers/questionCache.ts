import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { QuestionId } from "../common";
import { parseJsonc } from "../core/json";
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
  private updateTimer: NodeJS.Timeout | undefined;
  private rebuildPending = false;
  private notifyPending = false;
  private disposables: vscode.Disposable[] = [];

  public readonly onUpdated = this.onUpdatedEmitter.event;

  constructor(private courseCache: CourseCache) {
    // capture all question changes so that missing server.py/html files trigger
    this.fileWatcher = new FileWatcher("**/questions/**");

    this.disposables.push(
      this.fileWatcher.onUpdated((event) => {
        if (
          event.type === "refreshed" ||
          path.basename(event.uri.fsPath) === "info.json"
        ) {
          this.rebuildPending = true;
        }
        this.notifyPending = true;
        this.scheduleUpdate();
      }),
      this.courseCache.onUpdated(() => {
        this.rebuildPending = true;
        this.notifyPending = true;
        this.scheduleUpdate();
      }),
    );
  }

  /** Coalesce a file-system burst into one index rebuild and one notification. */
  private scheduleUpdate() {
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      this.updateTimer = undefined;
      if (this.rebuildPending) {
        this.rebuildIndex(this.fileWatcher.getUris());
      }
      this.rebuildPending = false;
      if (this.notifyPending) {
        this.onUpdatedEmitter.fire(this.getQuestionIds());
      }
      this.notifyPending = false;
    }, 100);
  }

  private rebuildIndex(uris: vscode.Uri[]) {
    this.questionIds = [];
    this.tagMap.clear();
    if (uris.length * 2 < QuestionCache.regexSafeIds.size) {
      QuestionCache.regexSafeIds.clear();
    }
    uris.forEach((uri) => this.addToIndex(uri));
  }

  private addToIndex(uri: vscode.Uri) {
    if (path.basename(uri.fsPath) !== "info.json") {
      return;
    }
    let rawData: string;
    try {
      rawData = fs.readFileSync(uri.fsPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return; // deleted while a coalesced rebuild was in progress
      }
      throw error;
    }
    const quid = this.courseCache.getQuestionIdFor(uri);
    this.questionIds.push(quid);
    if (!QuestionCache.regexSafeIds.has(quid.localId)) {
      QuestionCache.regexSafeIds.set(quid.localId, makeRegexSafe(quid.localId));
    }
    const info = parseJsonc(rawData) as { tags?: unknown } | undefined;
    const tags = Array.isArray(info?.tags) ? info.tags : [];
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
    clearTimeout(this.updateTimer);
    this.disposables.forEach((disposable) => disposable.dispose());
    this.fileWatcher.dispose();
    this.onUpdatedEmitter.dispose();
  }
}
