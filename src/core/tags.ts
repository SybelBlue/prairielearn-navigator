import { findNodeAtLocation, getLocation } from "jsonc-parser";
import { courseFiles, matchesGlob } from "./courseFiles";
import { JsonDoc, parseJsonDoc } from "./json";

/**
 * PrairieLearn's badge colors: text and background of `.badge.color-*` in
 * PrairieLearn's public/stylesheets/colors.css.
 */
export const plBadgeColors: Record<string, { text: string; background: string }> = {
  red1: { text: "#c73000", background: "#ffebe4" },
  red2: { text: "#9c0f00", background: "#ffc4be" },
  red3: { text: "#5a140d", background: "#f2aba3" },
  pink1: { text: "#c70053", background: "#ffe4ef" },
  pink2: { text: "#95053c", background: "#fdbed6" },
  pink3: { text: "#540d28", background: "#f2a8c4" },
  purple1: { text: "#72437b", background: "#f1e8f3" },
  purple2: { text: "#472555", background: "#d7bde2" },
  purple3: { text: "#2a0938", background: "#dcaaf1" },
  blue1: { text: "#006f8c", background: "#b0eeff" },
  blue2: { text: "#084465", background: "#9cd7f7" },
  blue3: { text: "#002748", background: "#7ec4ff" },
  turquoise1: { text: "#047573", background: "#bffdfc" },
  turquoise2: { text: "#125b56", background: "#a5eee9" },
  turquoise3: { text: "#003f3a", background: "#6bfff3" },
  green1: { text: "#00632d", background: "#d2ffe6" },
  green2: { text: "#155c33", background: "#aaecc6" },
  green3: { text: "#003f16", background: "#6bff9f" },
  yellow1: { text: "#665502", background: "#fef8db" },
  yellow2: { text: "#7f6606", background: "#fbebad" },
  yellow3: { text: "#604800", background: "#ffe289" },
  orange1: { text: "#995000", background: "#fff1e1" },
  orange2: { text: "#a32b00", background: "#ffd3c4" },
  orange3: { text: "#582513", background: "#ebb8a6" },
  brown1: { text: "#8b4d28", background: "#f5e5dc" },
  brown2: { text: "#60412e", background: "#e6d5cb" },
  brown3: { text: "#38271d", background: "#d4b9aa" },
  gray1: { text: "#656565", background: "#f3f3f3" },
  gray2: { text: "#414141", background: "#d3d3d3" },
  gray3: { text: "#242424", background: "#bdbdbd" },
};

/** The color PrairieLearn gives a tag that infoCourse.json does not define. */
export const implicitTagColor = "gray1";

export interface TagInfo {
  name: string;
  color?: string;
  description?: string;
}

/**
 * Tags PrairieLearn defines itself when a question uses them, from
 * DEFAULT_TAGS in PrairieLearn's src/sync/course-db.ts.
 */
const plDefaultTags: readonly TagInfo[] = [
  { name: "numeric", color: "brown1", description: "The answer format is one or more numerical values." },
  { name: "symbolic", color: "blue1", description: "The answer format is a symbolic expression." },
  {
    name: "drawing",
    color: "yellow1",
    description: "The answer format requires drawing on a canvas to input a graphical representation of an answer.",
  },
  {
    name: "MC",
    color: "green1",
    description:
      "The answer format is choosing from a small finite set of answers (multiple choice, possibly with multiple selections allowed, up to 10 possible answers).",
  },
  { name: "code", color: "turquoise1", description: "The answer format is a piece of code." },
  {
    name: "multianswer",
    color: "orange2",
    description: "The question requires multiple answers, either as steps in a sequence or as separate questions.",
  },
  { name: "graph", color: "purple1", description: "The question tests reading information from a graph or drawing a graph." },
  { name: "concept", color: "pink1", description: "The question tests conceptual understanding of a topic." },
  {
    name: "calculate",
    color: "green2",
    description: "The questions tests performing a numerical calculation, with either a calculator or equivalent software.",
  },
  {
    name: "compute",
    color: "purple1",
    description:
      "The question tests the writing and running of a piece of code to compute the answer. The answer itself is not the code, but could be a numeric answer output by the code, for example (use `code` when the answer is the code).",
  },
  { name: "software", color: "orange1", description: "The question tests the use of a specific piece of software (e.g., Matlab)." },
  {
    name: "estimation",
    color: "red2",
    description: "Answering the question correctly will require some amount of estimation, so an exact answer is not possible.",
  },
  {
    name: "secret",
    color: "red3",
    description: "Only use this question on exams or quizzes that won't be released to students, so the question can be kept secret.",
  },
  {
    name: "nontest",
    color: "green3",
    description:
      "This question is not appropriate for use in a restricted testing environment, so only use it on homeworks or similar.",
  },
  // Sp15, Su15, Fa15, ..., Fa21
  ...[15, 16, 17, 18, 19, 20, 21].flatMap((year) =>
    ["Sp", "Su", "Fa"].map((term): TagInfo => ({ name: `${term}${year}`, color: "gray1" }))
  ),
];

/** The PrairieLearn default tag named `name`, if there is one. */
export function plDefaultTag(name: string): TagInfo | undefined {
  return plDefaultTags.find((tag) => tag.name === name);
}

/** A tag defined in infoCourse.json, with the offsets of its name value. */
export interface CourseTag extends TagInfo {
  index: number;
  nameStart: number;
  nameEnd: number;
}

/** The tags an infoCourse.json defines, in order. */
export function courseTags(doc: JsonDoc): CourseTag[] {
  const array = doc.tree && findNodeAtLocation(doc.tree, ["tags"]);
  if (array?.type !== "array") {
    return [];
  }
  return (array.children ?? []).flatMap((item, index): CourseTag[] => {
    const name = findNodeAtLocation(item, ["name"]);
    if (typeof name?.value !== "string") {
      return [];
    }
    const color = findNodeAtLocation(item, ["color"])?.value;
    const description = findNodeAtLocation(item, ["description"])?.value;
    return [{
      name: name.value,
      color: typeof color === "string" ? color : undefined,
      description: typeof description === "string" ? description : undefined,
      index,
      nameStart: name.offset,
      nameEnd: name.offset + name.length,
    }];
  });
}

/**
 * The entry of a question's `tags` array at `offset`, with the offsets of
 * the string including its quotes.
 */
export function tagAt(
  text: string,
  doc: JsonDoc,
  offset: number
): { name: string; index: number; start: number; end: number } | undefined {
  const { path } = getLocation(text, offset);
  if (path.length !== 2 || path[0] !== "tags" || typeof path[1] !== "number" || !doc.tree) {
    return undefined;
  }
  const node = findNodeAtLocation(doc.tree, path);
  if (node?.type !== "string" || offset < node.offset || offset > node.offset + node.length) {
    return undefined;
  }
  return { name: node.value as string, index: path[1], start: node.offset, end: node.offset + node.length };
}

/**
 * The tag name at `offset` in a course file: a definition's `name` in
 * infoCourse.json, or an entry of a question's `tags` array. Offsets cover
 * the string including its quotes. `relPath` is relative to the course root.
 */
export function tagNameAt(
  relPath: string,
  text: string,
  offset: number
): { name: string; start: number; end: number; definition: boolean } | undefined {
  if (relPath === courseFiles.course) {
    const tag = courseTags(parseJsonDoc(text)).find((t) => t.nameStart <= offset && offset <= t.nameEnd);
    return tag && { name: tag.name, start: tag.nameStart, end: tag.nameEnd, definition: true };
  }
  if (matchesGlob(relPath, courseFiles.question)) {
    const tag = tagAt(text, parseJsonDoc(text), offset);
    return tag && { name: tag.name, start: tag.start, end: tag.end, definition: false };
  }
  return undefined;
}
