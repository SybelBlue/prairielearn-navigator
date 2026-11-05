import { courseAssessmentSets, implicitAssessmentSet } from "./assessmentSets";
import { JsonDoc } from "./json";
import { UsedNames } from "./referenceIndex";
import { courseTags, implicitTagColor } from "./tags";

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
}

export const tagKind: NameKind = {
  collection: "tags",
  noun: "tag",
  definitions: courseTags,
  implicitDefinition: (name) => ({ name, color: implicitTagColor, description: name }),
};

export const assessmentSetKind: NameKind = {
  collection: "assessmentSets",
  noun: "assessment set",
  definitions: courseAssessmentSets,
  implicitDefinition: (name) => {
    const { abbreviation, heading, color } = implicitAssessmentSet(name);
    return { abbreviation, name, heading, color };
  },
};
