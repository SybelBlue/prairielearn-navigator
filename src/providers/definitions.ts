import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { getQuestionDirFromId, QuestionId } from "./utils";
import { CourseCache } from "./filewatchers";

export class AssessmentDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private courseCache: CourseCache) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition> {
    function isQuestionId(obj: any, value: string): boolean {
      if (typeof obj !== "object" || obj === null) {
        return false;
      }

      for (const key in obj) {
        if (key === "id" && obj[key] === value) {
          return true;
        }
        if (typeof obj[key] === "object" && isQuestionId(obj[key], value)) {
          return true;
        }
      }

      return false;
    }

    function getConfirmedQuestionId(
      courseId: string,
      document: vscode.TextDocument,
      position: vscode.Position,
      range: vscode.Range
    ): QuestionId | null {
      const line = document.lineAt(position.line).text;
      const idMatch = line.match(/"id"\s*:\s*"([^"]+)"/);

      if (idMatch) {
        return {
          courseId,
          localId: idMatch[1], // e.g., "ch02/difficult"
        };
      }

      try {
        // try to determine by parsing the entire JSON document
        const json = JSON.parse(document.getText());
        const clickedText = document.getText(range).replace(/"/g, "");

        return isQuestionId(json, clickedText)
          ? {
              localId: clickedText,
              courseId,
            }
          : null;
      } catch (e) {
        if (!(e instanceof SyntaxError)) {
          console.error("prairielearn -- unexpected error parsing json: " + e);
        }
      }

      return null;
    }

    // Get the range of the quoted string at cursor
    const range = document.getWordRangeAtPosition(position, /"([^"]+)"/);
    if (!range) {
      return null;
    }

    const courseId = this.courseCache.getCourseIdFor(document.uri);
    const questionId = getConfirmedQuestionId(
      courseId,
      document,
      position,
      range
    );
    if (!questionId) {
      return null;
    }

    const questionDirPath = getQuestionDirFromId(questionId);

    if (!questionDirPath || !fs.existsSync(questionDirPath)) {
      return null;
    }

    const questionHtmlPath = path.join(questionDirPath, "question.html");
    const questionInfoJsonPath = path.join(questionDirPath, "info.json");

    const definitionPath = fs.existsSync(questionHtmlPath)
      ? questionHtmlPath
      : questionInfoJsonPath;

    if (!definitionPath) {
      return null;
    }

    return new vscode.Location(
      vscode.Uri.file(definitionPath),
      new vscode.Position(0, 0)
    );
  }
}
