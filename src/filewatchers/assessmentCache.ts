import * as path from "path";
import * as vscode from "vscode";
import { AssessmentId, InstanceId, LocalIdUsage, QuestionId } from "../common";
import { questionFilePathsFromId } from "../core/questionPaths";
import { Use } from "../core/referenceIndex";
import { CourseCache } from "./courseCache";
import { FileWatcher } from "./filewatcher";
import { ReferenceIndexCache } from "./referenceIndexCache";

const isAssessmentQuestionUse = (use: Use) =>
  use.ref.spec.target === "question" &&
  path.basename(use.file) === "infoAssessment.json";

/** A Use as a VS Code location (Use positions are 1-based). */
export function useLocation(use: Use): vscode.Location {
  return new vscode.Location(
    vscode.Uri.file(use.file),
    new vscode.Range(
      use.start.line - 1,
      use.start.column - 1,
      use.end.line - 1,
      use.end.column - 1
    )
  );
}

/** Lists assessments, and answers question uses from the reference index. */
export class AssessmentCache {
  private fileWatcher: FileWatcher;
  private onUpdatedEmitter = new vscode.EventEmitter<vscode.Uri[]>();

  public readonly onUpdated = this.onUpdatedEmitter.event;

  constructor(
    private courseCache: CourseCache,
    private references: ReferenceIndexCache
  ) {
    this.fileWatcher = new FileWatcher("**/assessments/**/infoAssessment.json");
    this.fileWatcher.onUpdated(() =>
      this.onUpdatedEmitter.fire(this.fileWatcher.getUris())
    );
    this.references.onChanged(({ changed }) => {
      if (path.basename(changed) === "infoAssessment.json") {
        this.onUpdatedEmitter.fire(this.fileWatcher.getUris());
      }
    });
  }

  /** Where assessments use a question, once the course is indexed. */
  async getQuestionUseLocations(questionId: QuestionId): Promise<vscode.Location[]> {
    const dir = vscode.Uri.file(questionFilePathsFromId(questionId).dir);
    const index = await this.references.whenIndexed(dir);
    return (index?.usesOf(dir.fsPath) ?? [])
      .filter(isAssessmentQuestionUse)
      .map(useLocation);
  }

  getQuestionUsesFor(assessmentId: AssessmentId): LocalIdUsage[] {
    const uri = AssessmentCache.getUriFrom(assessmentId);
    return (this.references.indexFor(uri)?.usesIn(uri.fsPath) ?? [])
      .filter(isAssessmentQuestionUse)
      .map((use) => ({ localId: use.ref.value, location: useLocation(use) }));
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

  static getUriFrom(assessmentId: AssessmentId): vscode.Uri {
    return vscode.Uri.file(
      path.join(
        assessmentId.courseId,
        "courseInstances",
        assessmentId.instanceId,
        "assessments",
        assessmentId.assessmentId,
        "infoAssessment.json"
      )
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
