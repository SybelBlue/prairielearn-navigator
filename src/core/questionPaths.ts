import * as fs from "node:fs";
import * as path from "node:path";
import { QuestionId } from "../common";

export type QuestionPaths = {
  dir: string;
  infoJson: string;
  questionHtml: string;
  serverPy: string;
};

export function questionFilePathsFromId(
  questionId: QuestionId
): QuestionPaths & { strict(): Partial<QuestionPaths> } {
  const dir = path.join(questionId.courseId, "questions", questionId.localId);

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
