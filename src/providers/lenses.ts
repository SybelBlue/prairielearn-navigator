import * as path from "path";
import * as vscode from "vscode";
import { AssessmentCache, CourseCache } from "./filewatchers";
import {
  getAssessmentLabelFromUri,
  getLocalQuestionIdFromUri,
  questionFilePathsFromId,
} from "./utils";

export class AssessmentJumpToSourcesCodeLensProvider
  implements vscode.CodeLensProvider
{
  constructor(private courseCache: CourseCache) {}

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

      for (const [key, p] of Object.entries(questionPaths.strict())) {
        if (key !== "dir") {
          lenses.push(
            new vscode.CodeLens(matchRange, {
              title: `${path.basename(p)}`,
              command: "prairielearn-navigator.openFile",
              arguments: [p],
            })
          );
        }
      }
    }

    return lenses;
  }
}

export class QuestionHeaderCodeLensProvider implements vscode.CodeLensProvider {
  constructor(
    private courseCache: CourseCache,
    private assessments: AssessmentCache
  ) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    const questionId = this.courseCache.getQuestionIdFor(document.uri);
    const occurrences = this.assessments.getQuestionUses(questionId);
    const firstLine = new vscode.Range(0, 0, 0, 0);

    lenses.push(
      new vscode.CodeLens(firstLine, {
        title:
          `${occurrences.length} reference` +
          (occurrences.length === 1 ? "" : "s"),
        command: "prairielearn-navigator.showOccurrences",
        arguments: [occurrences], // todo, maybe add def occurrence here
      })
    );

    if (occurrences.length < 5) {
      for (const occ of occurrences) {
        const title = getAssessmentLabelFromUri(occ.uri);
        lenses.push(
          new vscode.CodeLens(firstLine, {
            title,
            command: "prairielearn-navigator.openFile",
            arguments: [occ.uri.fsPath, occ.range],
          })
        );
      }
    }

    return lenses;
  }
}
