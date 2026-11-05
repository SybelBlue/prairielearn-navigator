import { findNodeAtLocation, getLocation } from "jsonc-parser";
import { courseFiles, matchesGlob } from "./courseFiles";
import { JsonDoc, parseJsonDoc } from "./json";
import { treeOf } from "./jsonTree";

export interface AssessmentSetInfo {
  name: string;
  abbreviation?: string;
  heading?: string;
  color?: string;
}

/**
 * Assessment sets PrairieLearn defines itself when an assessment uses them,
 * from DEFAULT_ASSESSMENT_SETS in PrairieLearn's src/sync/course-db.ts.
 */
const plDefaultAssessmentSets: readonly AssessmentSetInfo[] = [
  { abbreviation: "HW", name: "Homework", heading: "Homeworks", color: "green1" },
  { abbreviation: "Q", name: "Quiz", heading: "Quizzes", color: "red1" },
  { abbreviation: "PQ", name: "Practice Quiz", heading: "Practice Quizzes", color: "pink1" },
  { abbreviation: "E", name: "Exam", heading: "Exams", color: "brown1" },
  { abbreviation: "PE", name: "Practice Exam", heading: "Practice Exams", color: "yellow1" },
  { abbreviation: "P", name: "Prep", heading: "Question Preparation", color: "gray1" },
  { abbreviation: "MP", name: "Machine Problem", heading: "Machine Problems", color: "turquoise1" },
  { abbreviation: "WS", name: "Worksheet", heading: "Worksheets", color: "purple1" },
  { abbreviation: "U", name: "Unknown", heading: "Unknown", color: "red3" },
];

/** The PrairieLearn default assessment set named `name`, if there is one. */
export function plDefaultAssessmentSet(name: string): AssessmentSetInfo | undefined {
  return plDefaultAssessmentSets.find((set) => set.name === name);
}

/** Every PrairieLearn default assessment set, in PrairieLearn's order. */
export function plDefaultAssessmentSetList(): readonly AssessmentSetInfo[] {
  return plDefaultAssessmentSets;
}

/** The color PrairieLearn gives an assessment set that infoCourse.json does not define. */
export const implicitAssessmentSetColor = "gray1";

/**
 * The set PrairieLearn creates for an assessment set name that neither
 * infoCourse.json nor its defaults define, as makeImplicitEntity in
 * PrairieLearn's src/sync/fromDisk/assessmentSets.ts does.
 */
export function implicitAssessmentSet(name: string): Required<AssessmentSetInfo> {
  return { name, abbreviation: name, heading: name, color: implicitAssessmentSetColor };
}

/** An assessment set defined in infoCourse.json, with the offsets of its name value. */
export interface CourseAssessmentSet extends AssessmentSetInfo {
  index: number;
  nameStart: number;
  nameEnd: number;
}

/** The assessment sets an infoCourse.json defines, in order. */
export function courseAssessmentSets(doc: JsonDoc): CourseAssessmentSet[] {
  const tree = treeOf(doc);
  const array = tree && findNodeAtLocation(tree, ["assessmentSets"]);
  if (array?.type !== "array") {
    return [];
  }
  const text = (item: Parameters<typeof findNodeAtLocation>[0], key: string) => {
    const value = findNodeAtLocation(item, [key])?.value;
    return typeof value === "string" ? value : undefined;
  };
  return (array.children ?? []).flatMap((item, index): CourseAssessmentSet[] => {
    const name = findNodeAtLocation(item, ["name"]);
    if (typeof name?.value !== "string") {
      return [];
    }
    return [{
      name: name.value,
      abbreviation: text(item, "abbreviation"),
      heading: text(item, "heading"),
      color: text(item, "color"),
      index,
      nameStart: name.offset,
      nameEnd: name.offset + name.length,
    }];
  });
}

/**
 * An assessment's `set` at `offset`, with the offsets of the string
 * including its quotes, and the assessment's `number` if it is a string.
 */
export function assessmentSetAt(
  text: string,
  doc: JsonDoc,
  offset: number
): { name: string; number?: string; start: number; end: number } | undefined {
  const { path } = getLocation(text, offset);
  const tree = treeOf(doc);
  if (path.length !== 1 || path[0] !== "set" || !tree) {
    return undefined;
  }
  const node = findNodeAtLocation(tree, ["set"]);
  if (node?.type !== "string" || offset < node.offset || offset > node.offset + node.length) {
    return undefined;
  }
  const number = findNodeAtLocation(tree, ["number"])?.value;
  return {
    name: node.value as string,
    number: typeof number === "string" ? number : undefined,
    start: node.offset,
    end: node.offset + node.length,
  };
}

/**
 * The assessment set name at `offset` in a course file: a definition's
 * `name` in infoCourse.json, or an assessment's `set`. Offsets cover the
 * string including its quotes. `relPath` is relative to the course root.
 */
export function assessmentSetNameAt(
  relPath: string,
  text: string,
  offset: number
): { name: string; start: number; end: number; definition: boolean } | undefined {
  if (relPath === courseFiles.course) {
    const set = courseAssessmentSets(parseJsonDoc(text)).find((s) => s.nameStart <= offset && offset <= s.nameEnd);
    return set && { name: set.name, start: set.nameStart, end: set.nameEnd, definition: true };
  }
  if (matchesGlob(relPath, courseFiles.assessment)) {
    const set = assessmentSetAt(text, parseJsonDoc(text), offset);
    return set && { name: set.name, start: set.start, end: set.end, definition: false };
  }
  return undefined;
}
