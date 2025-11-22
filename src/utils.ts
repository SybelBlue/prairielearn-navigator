import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

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

function getQuestionDirFromId(questionId: QuestionId): string {
  return path.join(questionId.courseId, "questions", questionId.localId);
}

function getLocalQuestionIdFromUri(questionUri: vscode.Uri): string {
  const pathParts = questionUri.fsPath.split(path.sep);
  const questionsIndex = pathParts.indexOf("questions");
  return path.join(...pathParts.slice(questionsIndex + 1, -1));
}

const reTargets = /[\{\}\[\]\|\*\+\\\.\^]/g;
function makeRegexSafe(s: string) {
  return s.replaceAll(reTargets, "\\$&");
}

type LocalId = string;
type CourseId = string;
type QualifiedId = string;
type ScopedId = { courseId: CourseId; localId: LocalId };
type InstanceId = ScopedId;
type AssessmentId = {
  courseId: CourseId;
  qualifiedId: QualifiedId;
  instanceId: LocalId;
  assessmentId: LocalId;
};
type QuestionId = ScopedId;

type LocalIdUsage = {
  localId: LocalId;
  location: vscode.Location;
};

export {
  getLocalQuestionIdFromUri,
  getQuestionDirFromId,
  makeRegexSafe,
  questionFilePathsFromId,
};

export type {
  AssessmentId,
  CourseId,
  InstanceId,
  LocalId,
  LocalIdUsage,
  QualifiedId,
  QuestionId,
  ScopedId,
};
