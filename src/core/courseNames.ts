import { findNodeAtLocation, Node } from "jsonc-parser";
import {
  assessmentSetNameAt,
  courseAssessmentSets,
  implicitAssessmentSet,
  plDefaultAssessmentSet,
} from "./assessmentSets";
import { courseFiles } from "./courseFiles";
import { FileEdit } from "./fileEdits";
import { JsonDoc } from "./json";
import { appendJsonEdits, JsonFocus } from "./jsonEdits";
import { UsedNames } from "./referenceIndex";
import { courseTags, implicitTagColor, plDefaultTag, tagNameAt } from "./tags";

/** A name infoCourse.json defines, with the offsets of its `name` value. */
interface CourseNameDefinition {
  name: string;
  nameStart: number;
  nameEnd: number;
}

/**
 * A kind of name defined course-wide in infoCourse.json and used by other
 * course files: tags, used by questions, and assessment sets, used by
 * assessments.
 */
export interface NameKind {
  /** The infoCourse.json array defining these names, and their key in UsedNames. */
  collection: keyof UsedNames;
  /** "tag" or "assessment set", for messages. */
  noun: string;
  /** The definitions in an infoCourse.json, in order. */
  definitions(doc: JsonDoc): CourseNameDefinition[];
  /** The infoCourse.json entry PrairieLearn creates for a name used but not defined. */
  implicitDefinition(name: string): Record<string, string>;
  /** PrairieLearn's own definition of a name, if it has one. */
  plDefault(name: string): Record<string, string | undefined> | undefined;
  /** The entry field a user most wants to change after defining a name. */
  focusKey: string;
  /** Glob, relative to the course root, of the files that use these names. */
  useFiles: string;
  /**
   * The values in a using file that may be one of these names: every entry
   * of a question's `tags`, or an assessment's `set`. Not only strings, so
   * edits can find the separators between entries.
   */
  useItems(tree: Node): Node[];
  /** Rules whose suppressions identify one of these names by name. */
  rules: ReadonlySet<string>;
}

export const tagKind: NameKind = {
  collection: "tags",
  noun: "tag",
  definitions: courseTags,
  implicitDefinition: (name) => ({ name, color: implicitTagColor, description: name }),
  plDefault: (name) => {
    const tag = plDefaultTag(name);
    return tag && { ...tag };
  },
  // The color PrairieLearn would give a tag
  focusKey: "color",
  useFiles: courseFiles.question,
  useItems: (tree) => {
    const array = findNodeAtLocation(tree, ["tags"]);
    return array?.type === "array" ? array.children ?? [] : [];
  },
  rules: new Set(["unused-tag", "undefined-tag"]),
};

export const assessmentSetKind: NameKind = {
  collection: "assessmentSets",
  noun: "assessment set",
  definitions: courseAssessmentSets,
  implicitDefinition: (name) => {
    const { abbreviation, heading, color } = implicitAssessmentSet(name);
    return { abbreviation, name, heading, color };
  },
  plDefault: (name) => {
    const set = plDefaultAssessmentSet(name);
    return set && { ...set };
  },
  // PrairieLearn would make the abbreviation the whole name
  focusKey: "abbreviation",
  useFiles: courseFiles.assessment,
  useItems: (tree) => {
    const set = findNodeAtLocation(tree, ["set"]);
    return set ? [set] : [];
  },
  rules: new Set(["unused-assessment-set", "undefined-assessment-set"]),
};

/** "Tag" or "Assessment set". */
export function nounTitle(kind: NameKind): string {
  return kind.noun[0].toUpperCase() + kind.noun.slice(1);
}

/** A problem with `name` as a new definition, given the names already defined. */
export function courseNameProblem(kind: NameKind, name: string, defined: readonly string[]): string | undefined {
  if (name.trim() === "") {
    return `${nounTitle(kind)} names must not be empty`;
  }
  if (defined.includes(name)) {
    return `${nounTitle(kind)} "${name}" is already defined in ${courseFiles.course}`;
  }
  return undefined;
}

export interface NameDefinition {
  edits: FileEdit[];
  focus: JsonFocus;
}

/** Plans appending `entry` to `kind`'s array in `infoCourse`, whose contents are `text`. */
export function planNameDefinition(
  kind: NameKind,
  infoCourse: string,
  text: string,
  entry: object
): NameDefinition {
  return {
    edits: appendJsonEdits(infoCourse, text, kind.collection, entry),
    focus: { file: infoCourse, path: [kind.collection, -1, kind.focusKey] },
  };
}

/**
 * The tag or assessment set name at `offset` in a course file: a
 * definition's `name` in infoCourse.json, or a use in a question or
 * assessment. Offsets cover the string including its quotes. `relPath` is
 * relative to the course root.
 */
export function courseNameAt(
  relPath: string,
  text: string,
  offset: number
): { kind: NameKind; name: string; start: number; end: number; definition: boolean } | undefined {
  const tag = tagNameAt(relPath, text, offset);
  if (tag) {
    return { kind: tagKind, ...tag };
  }
  const set = assessmentSetNameAt(relPath, text, offset);
  return set && { kind: assessmentSetKind, ...set };
}
