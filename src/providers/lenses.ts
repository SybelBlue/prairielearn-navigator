import * as path from "path";
import * as vscode from "vscode";
import { AssessmentCache, CourseCache } from "../filewatchers";
import { questionFilePathsFromId } from "../utils";

function getAssessmentCourseInstanceId(assessmentUri: vscode.Uri): string {
  const pathParts = assessmentUri.fsPath.split(path.sep);
  const assessmentsIndex = pathParts.indexOf("assessments");
  return path.join(...pathParts.slice(0, assessmentsIndex));
}

function getAssessmentCourseInstanceDisplayName(
  assessmentUri: vscode.Uri
): string {
  const pathParts = assessmentUri.fsPath.split(path.sep);
  const instanceIndex = pathParts.indexOf("courseInstances");
  const assessmentsIndex = pathParts.indexOf("assessments");
  return path.join(...pathParts.slice(instanceIndex + 1, assessmentsIndex));
}

function getQualifiedAssessmentDisplayName(assessmentUri: vscode.Uri): string {
  const pathParts = assessmentUri.fsPath.split(path.sep);
  const instanceIndex = pathParts.indexOf("courseInstances");
  const assessmentsIndex = pathParts.indexOf("assessments");
  return path.join(
    ...pathParts.slice(instanceIndex + 1, assessmentsIndex),
    ...pathParts.slice(assessmentsIndex + 1, -1)
  );
}

function pluralize(n: number, s: string) {
  return n + " " + s + (n === 1 ? "" : "s");
}

export class AssessmentQuestionIdCodeLensProvider
  implements vscode.CodeLensProvider
{
  constructor(
    private courseCache: CourseCache,
    private assessmentCache: AssessmentCache
  ) {}

  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const courseId = this.courseCache.getCourseIdFor(document.uri);

    const re = /"id"\s*:[\n\s]*"([^"]+)"/gm;
    let match;
    while ((match = re.exec(text))) {
      const questionId = { localId: match[1], courseId };
      const matchRange = new vscode.Range(
        document.positionAt(match.index),
        document.positionAt(match.index + match[0].length)
      );
      const questionPaths = questionFilePathsFromId(questionId);
      if (!questionPaths) {
        lenses.push(
          new vscode.CodeLens(matchRange, {
            title: `!! Unknown Id !!`,
            command: "prairielearn-navigator.unknownId",
            arguments: [questionId.localId],
          })
        );
        continue;
      }

      const assessmentId = this.assessmentCache.getAssessmentIdFor(
        document.uri
      );
      if (assessmentId !== null) {
        const allOccurrences = this.assessmentCache.getQuestionUses(questionId);
        const instanceOccurrences = allOccurrences.filter(
          (use) => assessmentId.localId === use.localId
        );
        const filtered = instanceOccurrences;
        if (filtered.length) {
          const instDispName = getAssessmentCourseInstanceDisplayName(
            document.uri
          );
          lenses.push(
            new vscode.CodeLens(matchRange, {
              title: `${pluralize(
                filtered.length,
                "reuse"
              )} in ${instDispName}!`,
              command: "prairielearn-navigator.showOccurrences",
              arguments: [allOccurrences.map((occ) => occ.location)], // todo, maybe add def occurrence here
            })
          );
        }
      }

      // for (const [key, p] of Object.entries(questionPaths.strict())) {
      //   if (key !== "dir") {
      //     lenses.push(
      //       new vscode.CodeLens(matchRange, {
      //         title: `${path.basename(p)}`,
      //         command: "prairielearn-navigator.openFile",
      //         arguments: [p],
      //       })
      //     );
      //   }
      // }
    }

    return lenses;
  }
}

export class QuestionHeaderCodeLensProvider implements vscode.CodeLensProvider {
  constructor(
    private courseCache: CourseCache,
    private assessmentCache: AssessmentCache
  ) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    const questionId = this.courseCache.getQuestionIdFor(document.uri);
    const occurrences = this.assessmentCache.getQuestionUses(questionId);
    const firstLine = new vscode.Range(0, 0, 0, 0);

    lenses.push(
      new vscode.CodeLens(firstLine, {
        title: pluralize(occurrences.length, `reference`),
        command: "prairielearn-navigator.showOccurrences",
        arguments: [occurrences.map((occ) => occ.location)], // todo, maybe add def occurrence here
      })
    );

    if (occurrences.length < 5) {
      for (const occ of occurrences) {
        const title = getQualifiedAssessmentDisplayName(occ.location.uri);
        lenses.push(
          new vscode.CodeLens(firstLine, {
            title,
            command: "prairielearn-navigator.openFile",
            arguments: [occ.location.uri.fsPath, occ.location.range],
          })
        );
      }
    }

    return lenses;
  }
}
