import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

function getQuestionDirFromId(questionId: QuestionId): null | string {
  return path.join(questionId.courseId, "questions", questionId.localId);
}

type QuestionPaths = {
  dir: string;
  infoJson: string;
  questionHtml: string;
  serverPy: string;
};

function questionFilePathsFromId(
  questionId: QuestionId
): (QuestionPaths & { strict(): Partial<QuestionPaths> }) | null {
  const dir = getQuestionDirFromId(questionId);
  console.debug(dir);

  if (!dir || !fs.existsSync(dir)) {
    return null;
  }

  const infoJson = path.join(dir, "info.json");
  const html = path.join(dir, "question.html");
  const serverPy = path.join(dir, "server.py");
  return {
    dir,
    infoJson,
    questionHtml: html,
    serverPy,
    /** Only returns existing file-paths */
    strict(): Partial<QuestionPaths> {
      const out: Partial<QuestionPaths> = {};
      if (fs.existsSync(dir)) {
        out.dir = dir;
      }
      if (fs.existsSync(infoJson)) {
        out.infoJson = infoJson;
      }
      if (fs.existsSync(html)) {
        out.questionHtml = html;
      }
      if (fs.existsSync(serverPy)) {
        out.serverPy = serverPy;
      }
      return out;
    },
  };
}

type QuestionId = { courseId: string; localId: string };

function getLocalQuestionIdFromUri(questionUri: vscode.Uri): string {
  const pathParts = questionUri.fsPath.split(path.sep);
  const questionsIndex = pathParts.indexOf("questions");
  return path.join(...pathParts.slice(questionsIndex + 1, -1));
}

function getAssessmentLabelFromUri(uri: vscode.Uri): string {
  const pathParts = uri.fsPath.split(path.sep);
  const instanceIndex = pathParts.indexOf("courseInstances");
  const assessmentsIndex = pathParts.indexOf("assessments");
  return path.join(
    ...pathParts.slice(instanceIndex + 1, assessmentsIndex),
    ...pathParts.slice(assessmentsIndex + 1, -1)
  );
}

const reTargets = /[\{\}\[\]\|\*\+\\\.\^]/g;
function makeRegexSafe(s: string) {
  return s.replaceAll(reTargets, "\\$&");
}

export {
  getQuestionDirFromId,
  questionFilePathsFromId,
  getLocalQuestionIdFromUri,
  makeRegexSafe,
  getAssessmentLabelFromUri,
  type QuestionPaths,
  type QuestionId,
};
