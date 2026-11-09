import * as path from "node:path";
import { courseFiles } from "./courseFiles";
import { parseJsonDoc } from "./json";

/** A new file: nothing exists at `file` yet. */
export interface NewFile {
  file: string;
  contents: string;
}

/** The title a new question starts with until its author changes it. */
export const newQuestionTitle = "New Question";

/** The title a new assessment starts with until its author changes it. */
export const newAssessmentTitle = "New Assessment";

/** The names of the topics an infoCourse.json defines, in order. */
export function courseTopics(infoCourseText: string): string[] {
  const topics = (parseJsonDoc(infoCourseText).value as { topics?: unknown } | undefined)?.topics;
  return Array.isArray(topics)
    ? topics.flatMap((t: { name?: unknown } | null) => (typeof t?.name === "string" ? [t.name] : []))
    : [];
}

/** The topic a new question starts with: the course's first, if it defines any. */
export function defaultTopic(infoCourseText: string | undefined): string {
  return courseTopics(infoCourseText ?? "")[0] ?? "Unknown";
}

function json(value: object): string {
  return JSON.stringify(value, undefined, 2) + "\n";
}

/** The contents of a new question's info.json. */
export function questionInfo(uuid: string, title: string, topic: string): string {
  return json({ uuid, title, topic, type: "v3" });
}

const questionHtmlStub = `<pl-question-panel>
  <p>Write your question here.</p>
</pl-question-panel>
`;

/** The files of a new question in `dir`, info.json first. */
export function newQuestionFiles(dir: string, uuid: string, title: string, topic: string): NewFile[] {
  return [
    { file: path.join(dir, path.basename(courseFiles.question)), contents: questionInfo(uuid, title, topic) },
    { file: path.join(dir, "question.html"), contents: questionHtmlStub },
  ];
}

/** The infoAssessment.json of a new assessment in `dir`. */
export function newAssessmentInfo(
  dir: string,
  uuid: string,
  { type, title, set, number }: Record<string, string>
): NewFile {
  return {
    file: path.join(dir, path.basename(courseFiles.assessment)),
    contents: json({ uuid, type, title, set, number, zones: [] }),
  };
}
