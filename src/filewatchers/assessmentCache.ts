import * as vscode from "vscode";
import { getQuestionDirFromId, QuestionId } from "../utils";
import { FileWatcher } from "./filewatcher";
import { CourseCache } from "./courseCache";
import { QuestionCache } from "./questionCache";

export class AssessmentCache {
  private questionUses: Map<string, vscode.Location[]> = new Map();
  private fileWatcher: FileWatcher;
  private onUpdatedEmitter = new vscode.EventEmitter<vscode.Uri[]>();

  public readonly onUpdated = this.onUpdatedEmitter.event;

  constructor(
    private courseCache: CourseCache,
    private questionCache: QuestionCache
  ) {
    this.fileWatcher = new FileWatcher("**/assessments/**/infoAssessment.json");

    this.fileWatcher.onUpdated(async (event) => {
      if (event.type === "refreshed") {
        await this.rebuildIndex(event.uris);
      } else {
        await this.addToIndex(event.uri);
      }
      this.onUpdatedEmitter.fire(this.fileWatcher.getUris());
    });

    this.questionCache.onUpdated(() => {
      this.rebuildIndex(this.fileWatcher.getUris());
      this.onUpdatedEmitter.fire(this.fileWatcher.getUris());
    });
  }

  private async rebuildIndex(uris: vscode.Uri[]) {
    this.questionUses.clear();
    await Promise.all(uris.map((uri) => this.addToIndex(uri)));
  }

  private async addToIndex(uri: vscode.Uri) {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (!doc) {
      return;
    }
    const courseId = this.courseCache.getCourseIdFor(uri);

    const questionIds = this.questionCache
      .getCourseRegexSafeQuestionIds(courseId)
      .join("|");
    const re = RegExp(`"id"\\s*:[\\s\\n]*"(${questionIds})"`, "gm");
    const docText = doc.getText();
    let match;
    while ((match = re.exec(docText))) {
      const matchEnd = match.index + match[0].length;
      const localId = match[1];
      const newLocation = new vscode.Location(
        doc.uri,
        new vscode.Range(
          doc.positionAt(matchEnd - (localId.length + 1)),
          doc.positionAt(matchEnd - 1)
        )
      );
      const quid = { localId, courseId };
      const key = getQuestionDirFromId(quid);
      const value = this.questionUses.get(key);
      if (value) {
        value.push(newLocation);
      } else {
        this.questionUses.set(key, [newLocation]);
      }
    }
  }

  public getQuestionUses(questionId: QuestionId): vscode.Location[] {
    return [...(this.questionUses.get(getQuestionDirFromId(questionId)) || [])];
  }

  public getAssessmentJsons() {
    return this.fileWatcher.getUris();
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onUpdatedEmitter.dispose();
  }
}
