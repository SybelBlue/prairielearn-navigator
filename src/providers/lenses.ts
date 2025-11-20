import * as vscode from "vscode";
import * as path from "path";
import {
  getAssessmentLabelFromUri,
  getQuestionIdFromUri,
  questionFilePathsFromId,
} from "./utils";

export class AssessmentCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();

    const re = /"id"\s*:[\n\s]*"([^"]+)"/gm;
    let match;
    while ((match = re.exec(text))) {
      const questionId = match[1];
      const matchRange = new vscode.Range(
        document.positionAt(match.index),
        document.positionAt(match.index + match[0].length)
      );
      const questionPaths = questionFilePathsFromId(document, questionId);
      if (!questionPaths) {
        lenses.push(
          new vscode.CodeLens(matchRange, {
            title: `!! Unknown Id !!`,
            command: "prairielearn-navigator.unknownId",
            arguments: [questionId],
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
  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    const questionId = getQuestionIdFromUri(document.uri);
    const occurrences = await this.findOccurrences(questionId);
    const firstLine = new vscode.Range(0, 0, 0, 0);

    lenses.push(
      new vscode.CodeLens(firstLine, {
        title:
          `${occurrences.length} reference` +
          (occurrences.length === 1 ? "" : "s"),
        command: "prairielearn-navigator.showOccurrences",
        arguments: [occurrences],
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

  private async findOccurrences(
    questionId: string
  ): Promise<vscode.Location[]> {
    const as = await vscode.workspace.findFiles(
      "**/assessments/**/infoAssessment.json"
    );
    const re = new RegExp(`"id"\\s*:[\\s\\n]*"${questionId}"`, "gm");
    const out = [];
    for (const uri of as) {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (!doc) {
        return [];
      }
      const docText = doc.getText();
      let match;
      while ((match = re.exec(docText))) {
        const matchEnd = match.index + match[0].length;
        out.push(
          new vscode.Location(
            doc.uri,
            new vscode.Range(
              doc.positionAt(matchEnd - (questionId.length + 1)),
              doc.positionAt(matchEnd - 1)
            )
          )
        );
      }
    }
    return out;
  }
}
