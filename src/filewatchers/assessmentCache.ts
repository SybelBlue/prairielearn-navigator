import * as path from "path";
import * as vscode from "vscode";
import {
  AssessmentId,
  CourseId,
  InstanceId,
  LocalId,
  LocalIdUsage,
  QualifiedId,
  QuestionId,
} from "../utils";
import { CourseCache } from "./courseCache";
import { FileWatcher } from "./filewatcher";
import { QuestionCache } from "./questionCache";

export class AssessmentCache {
  private assessmentUses: Map<LocalId, Map<QualifiedId, LocalIdUsage[]>> =
    new Map();
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
    this.assessmentUses.clear();
    await Promise.all(uris.map((uri) => this.addToIndex(uri)));
  }

  private async addToIndex(uri: vscode.Uri) {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (!doc) {
      return;
    }
    const assessmentId = this.getAssessmentIdFor(uri)!;
    let assessmentMap = this.assessmentUses.get(assessmentId.courseId);
    if (assessmentMap === undefined) {
      this.assessmentUses.set(
        assessmentId.courseId,
        (assessmentMap = new Map())
      );
    }
    assessmentMap.set(
      assessmentId.qualifiedId,
      this.getUsesIn(assessmentId.courseId, doc)
    );
  }

  private getUsesIn(
    courseId: CourseId,
    doc: vscode.TextDocument
  ): LocalIdUsage[] {
    const docText = doc.getText();
    const questionIds = this.questionCache
      .getCourseRegexSafeQuestionIds(courseId)
      .join("|");
    const re = RegExp(`"id"\\s*:[\\s\\n]*"(${questionIds})"`, "gm");
    const out = [];
    let match;
    while ((match = re.exec(docText))) {
      const matchEnd = match.index + match[0].length;
      const localId = match[1];
      const location = new vscode.Location(
        doc.uri,
        new vscode.Range(
          doc.positionAt(matchEnd - (localId.length + 1)),
          doc.positionAt(matchEnd - 1)
        )
      );
      out.push({ localId, location });
    }
    return out;
  }

  getQuestionUseLocations(questionId: QuestionId): vscode.Location[] {
    const assessmentMap = this.assessmentUses.get(questionId.courseId);
    if (assessmentMap === undefined) {
      return [];
    }
    const out = [];
    for (const [assessmentLocalId, uses] of assessmentMap) {
      for (const u of uses) {
        if (u.localId === questionId.localId) {
          out.push(u.location);
        }
      }
    }
    return out;
  }

  getQuestionUsesFor(assessmentId: AssessmentId): LocalIdUsage[] {
    return [
      ...(this.assessmentUses
        .get(assessmentId.courseId)
        ?.get(assessmentId.qualifiedId) ?? []),
    ];
  }

  getAssessmentIdFor(assessmentUri: vscode.Uri): AssessmentId | null {
    const { courseId, localId } =
      this.courseCache.getScopedIdFor(assessmentUri);
    const parts = path.normalize(localId).split(path.sep);
    const index = parts.indexOf("assessments");
    if (index === -1) {
      return null;
    }
    return {
      courseId,
      qualifiedId: path.join(...parts.slice(1)),
      assessmentId: path.join(...parts.slice(index + 1)),
      instanceId: path.join(...parts.slice(1, index)),
    };
  }

  getAssessmentsFor(instanceId: InstanceId): AssessmentId[] {
    return this.getAssessmentJsons()
      .map((uri) => this.getAssessmentIdFor(uri))
      .filter((aid) => aid !== null)
      .filter(
        (aid) =>
          aid.courseId === instanceId.courseId &&
          aid.instanceId === instanceId.localId
      );
  }

  public getAssessmentJsons() {
    return this.fileWatcher.getUris();
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onUpdatedEmitter.dispose();
  }
}
