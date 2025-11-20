import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * Assumes course directory has `courseInstances/` and `questions/` as direct children
 * and that the document is in the `courseInstances/` or  `questions/` directories,
 * otherwise assumes the workspace root is the course directory, and infers the path
 */
function getQuestionDirFromId(
  document: vscode.TextDocument,
  questionId: string
): null | string {
  // TODO: there should be per-course instancing on all of this
  const pathParts = document.uri.fsPath.split(path.sep);
  let courseTop = pathParts.indexOf("courseInstances");
  if (courseTop < 0) {
    courseTop = pathParts.indexOf("questions");
  }
  let leader;
  if (courseTop < 0) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      console.error(`prairielearn -- document not in a course ${document.uri}`);
      return null;
    }
    leader = [workspaceFolder.uri.fsPath];
  } else {
    leader = pathParts.slice(0, courseTop);
  }

  return path.join(...leader, "questions", questionId);
}

type QuestionPaths = {
  dir: string;
  infoJson: string;
  questionHtml: string;
  serverPy: string;
};

function questionFilePathsFromId(
  document: vscode.TextDocument,
  questionId: string
): (QuestionPaths & { strict(): Partial<QuestionPaths> }) | null {
  const dir = getQuestionDirFromId(document, questionId);

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

function getQuestionIdFromUri(questionUri: vscode.Uri): string {
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
  getQuestionIdFromUri,
  makeRegexSafe,
  getAssessmentLabelFromUri,
  type QuestionPaths,
};
