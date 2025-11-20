import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

function getQuestionDirFromId(
  document: vscode.TextDocument,
  questionId: string
): null | string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    return null;
  }

  return path.join(workspaceFolder.uri.fsPath, "questions", questionId);
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

export {
  getQuestionDirFromId,
  questionFilePathsFromId,
  getQuestionIdFromUri,
  type QuestionPaths,
};
