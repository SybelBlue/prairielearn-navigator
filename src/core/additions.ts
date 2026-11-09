import * as path from "node:path";
import { knownAssessmentSetNames } from "./assessmentSets";
import { assessmentPrefixFor, assessmentTarget, nextAssessmentNumber } from "./assessments";
import { assessmentSetKind, courseNameProblem, NameKind, planNameDefinition, tagKind } from "./courseNames";
import { courseFiles, courseRelativePath, isWithinDir, relativeIdProblem } from "./courseFiles";
import { FileEdit } from "./fileEdits.js";
import { parseJsonDoc } from "./json";
import { JsonFocus } from "./jsonEdits.js";
import { folderOutside, placementProblem } from "./placement";
import { ReferenceIndex } from "./referenceIndex.js";
import { plBadgeColors } from "./tags";
import {
  courseTopics,
  defaultTopic,
  newAssessmentInfo,
  newAssessmentTitle,
  NewFile,
  newQuestionFiles,
  newQuestionTitle,
} from "./templates.js";

/** What a noun needs to know about the course. */
export interface AddContext {
  index: ReferenceIndex;
  /** Course-instance ids captured once for this add operation. */
  courseInstances: readonly string[];
  /** A file's current text (an unsaved editor's, in VS Code). */
  readText: (file: string) => string | undefined;
}

export type AddValues = Readonly<Record<string, string>>;

/**
 * One value a noun needs, in the CLI a flag and in VS Code a step. Each
 * callback sees the values of the fields before it.
 */
export interface AddField {
  /** The key in `AddValues`, and the name of the CLI flag. */
  key: string;
  label: string;
  /** What the value is and how it defaults, for usage text. */
  usage: string;
  choices?(ctx: AddContext, values: AddValues): readonly string[];
  /** Whether a value outside `choices` can be valid. */
  allowCustom?: boolean;
  defaultValue?(ctx: AddContext, values: AddValues): string | undefined;
  problem?(value: string, ctx: AddContext, values: AddValues): string | undefined;
}

/** What adding something to a course does: creates files, or edits existing ones. */
export type CourseAddition = {
  focus: JsonFocus;
  warnings: string[];
} & ({ kind: "files"; created: NewFile[] } | { kind: "edits"; edits: FileEdit[] });

export interface AddNoun {
  /** "question", for messages. */
  noun: string;
  /** Whether `plan` uses its `uuid`, which can be slow or fail to generate. */
  needsUuid?: boolean;
  /** What adding one does, for usage text. */
  description: string;
  /** Examples of the CLI arguments. */
  examples: readonly string[];
  /** `fields[0]` identifies the new thing. Later fields follow in order. */
  fields: readonly AddField[];
  /** The start of the id of something added at `dir`, an absolute directory. */
  idPrefix?(ctx: AddContext, dir: string): string;
  /** Plans the addition from values `resolveAddValues` accepts. Throws, with a message for the user. */
  plan(ctx: AddContext, values: AddValues, uuid: string): CourseAddition;
}

/** A course's infoCourse.json. Throws when it can't be read. */
function infoCourse(ctx: AddContext) {
  const file = path.join(ctx.index.courseRoot, courseFiles.course);
  const text = ctx.readText(file);
  if (text === undefined) {
    throw new Error(`Could not read ${courseFiles.course}`);
  }
  return { file, text };
}

/** A problem with a path-like id for something new, on top of relativeIdProblem. */
function newIdProblem(noun: string, id: string): string | undefined {
  // PrairieLearn skips hidden directories, so it would never find it
  return relativeIdProblem(noun, id) ??
    (id.split("/").some((segment) => segment.startsWith("."))
      ? `${noun} "${id}" must not have path segments starting with "."`
      : undefined);
}

function textField(key: string, label: string, defaultValue: string): AddField {
  return {
    key,
    label,
    usage: `${label} (default: ${defaultValue})`,
    defaultValue: () => defaultValue,
    problem: (value) => (value.trim() === "" ? `${label} must not be empty` : undefined),
  };
}

const colors = Object.keys(plBadgeColors);

/** The noun for a kind of name, which an entry in infoCourse.json defines. */
function nameNoun(
  kind: NameKind,
  description: string,
  examples: readonly string[],
  fields: readonly AddField[]
): AddNoun {
  const entryDefaults = (name: string) => ({ ...kind.implicitDefinition(name), ...kind.plDefault(name) });
  return {
    noun: kind.noun,
    description,
    examples,
    fields: [
      {
        key: "name",
        label: "Name",
        usage: `Name of the new ${kind.noun}`,
        problem: (name, ctx) => {
          const defined = kind.definitions(parseJsonDoc(infoCourse(ctx).text)).map((d) => d.name);
          return courseNameProblem(kind, name, defined);
        },
      },
      ...fields.map((field): AddField => ({
        ...field,
        defaultValue: (_ctx, values) => entryDefaults(values.name)[field.key],
      })),
    ],
    plan(ctx, values) {
      const { file, text } = infoCourse(ctx);
      const entry = Object.fromEntries(
        Object.keys(entryDefaults(values.name)).map((key) => [key, values[key]])
      );
      return { kind: "edits", warnings: [], ...planNameDefinition(kind, file, text, entry) };
    },
  };
}

const colorField: AddField = {
  key: "color",
  label: "Color",
  usage: "A PrairieLearn color, such as blue1 (default: PrairieLearn's for this name, or gray1)",
  choices: () => colors,
};

function questionsDir(ctx: AddContext): string {
  return path.join(ctx.index.courseRoot, "questions");
}

function questionDir(ctx: AddContext, qid: string): string {
  return path.join(questionsDir(ctx), ...qid.split("/"));
}

const questionNoun: AddNoun = {
  noun: "question",
  needsUuid: true,
  description: "Add a question: create its directory, with an info.json and a question.html.",
  examples: [
    "qid add unit1/quadratic",
    `qid add --write --title "Quadratics" --topic Algebra unit1/quadratic`,
  ],
  fields: [
    {
      key: "qid",
      label: "QID",
      usage: "Its path under questions/",
      problem: (qid, ctx) =>
        newIdProblem("QID", qid) ??
        placementProblem(
          "QID",
          qid,
          questionDir(ctx, qid),
          questionsDir(ctx),
          path.basename(courseFiles.question),
          (dir) => courseRelativePath(questionsDir(ctx), dir)
        ),
    },
    textField("title", "Title", newQuestionTitle),
    {
      key: "topic",
      label: "Topic",
      usage: "Topic (default: the course's first)",
      allowCustom: true,
      choices: (ctx) => courseTopics(infoCourse(ctx).text),
      defaultValue: (ctx) => defaultTopic(infoCourse(ctx).text),
      problem: (topic) => (topic.trim() === "" ? "Topic must not be empty" : undefined),
    },
  ],
  idPrefix(ctx, dir) {
    const root = questionsDir(ctx);
    if (!isWithinDir(root, dir)) {
      return "";
    }
    const rel = courseRelativePath(root, folderOutside(dir, root, path.basename(courseFiles.question)));
    return rel ? `${rel}/` : "";
  },
  plan(ctx, values, uuid) {
    const { qid, title, topic } = values;
    const created = newQuestionFiles(questionDir(ctx, qid), uuid, title, topic);
    const defined = courseTopics(infoCourse(ctx).text).includes(topic);
    return {
      kind: "files",
      created,
      focus: { file: created[0].file, path: ["title"] },
      warnings: defined
        ? []
        : [`Topic "${topic}" is not defined in ${courseFiles.course}; PrairieLearn will create it`],
    };
  },
};

const assessmentNoun: AddNoun = {
  noun: "assessment",
  needsUuid: true,
  description: "Add an assessment to a course instance: create its directory and infoAssessment.json.",
  examples: [
    "assessment add Fa26/hw2",
    `assessment add --write --title "Homework 2" --set Homework --type Homework Fa26/hw2`,
  ],
  fields: [
    {
      key: "assessment",
      label: "Assessment",
      usage: "Its course instance, then its path under the instance's assessments/",
      problem: (id, ctx) => {
        const problem = newIdProblem("Assessment", id);
        if (problem) {
          return problem;
        }
        const target = assessmentTarget(ctx.index.courseRoot, id, ctx.courseInstances);
        if (typeof target === "string") {
          return target;
        }
        return placementProblem(
          "Assessment",
          id,
          target.dir,
          target.assessmentsDir,
          path.basename(courseFiles.assessment),
          (dir) => `${target.instance}/${courseRelativePath(target.assessmentsDir, dir)}`
        );
      },
    },
    textField("title", "Title", newAssessmentTitle),
    {
      key: "set",
      label: "Set",
      usage: "An assessment set (default: the course's first, or Homework)",
      choices: (ctx) => knownAssessmentSetNames(infoCourse(ctx).text),
      defaultValue: (ctx) => knownAssessmentSetNames(infoCourse(ctx).text)[0],
      problem: (set, ctx) =>
        knownAssessmentSetNames(infoCourse(ctx).text).includes(set)
          ? undefined
          : `Assessment set "${set}" is not defined; add it first with "assessment-set add"`,
    },
    {
      key: "number",
      label: "Number",
      usage: "Its number in the set (default: the next one)",
      defaultValue: (ctx, { assessment, set }) => {
        const target = assessmentTarget(ctx.index.courseRoot, assessment, ctx.courseInstances);
        return typeof target === "string"
          ? undefined
          : nextAssessmentNumber(ctx.index, ctx.readText, target.instance, set);
      },
      problem: (number) => (number.trim() === "" ? "Number must not be empty" : undefined),
    },
    {
      key: "type",
      label: "Type",
      usage: "Homework or Exam (default: Homework)",
      choices: () => ["Homework", "Exam"],
      defaultValue: () => "Homework",
    },
  ],
  idPrefix: (ctx, dir) => assessmentPrefixFor(ctx.index.courseRoot, dir, ctx.courseInstances),
  plan(ctx, values, uuid) {
    const target = assessmentTarget(ctx.index.courseRoot, values.assessment, ctx.courseInstances);
    if (typeof target === "string") {
      throw new Error(target);
    }
    const created = newAssessmentInfo(target.dir, uuid, values);
    return {
      kind: "files",
      created: [created],
      focus: { file: created.file, path: ["title"] },
      warnings: [],
    };
  },
};

/** Everything that can be added to a course, by CLI noun. */
export const addNouns = {
  qid: questionNoun,
  tag: nameNoun(
    tagKind,
    `Add a tag to ${courseFiles.course}.`,
    ["tag add calculus", "tag add --write --color blue1 --description \"Uses calculus\" calculus"],
    [
      colorField,
      {
        key: "description",
        label: "Description",
        usage: "What it means (default: PrairieLearn's for this name, or the name)",
      },
    ]
  ),
  "assessment-set": nameNoun(
    assessmentSetKind,
    `Add an assessment set to ${courseFiles.course}.`,
    ["assessment-set add Lab", "assessment-set add --write --abbreviation L --heading Labs Lab"],
    [
      {
        key: "abbreviation",
        label: "Abbreviation",
        usage: "Short form, such as HW (default: PrairieLearn's for this name, or the name)",
      },
      {
        key: "heading",
        label: "Heading",
        usage: "Plural heading (default: PrairieLearn's for this name, or the name)",
      },
      colorField,
    ]
  ),
  assessment: assessmentNoun,
} as const satisfies Record<string, AddNoun>;

/** A problem with `value` for `field`, given the values before it. */
function fieldProblem(field: AddField, value: string, ctx: AddContext, values: AddValues): string | undefined {
  const problem = field.problem?.(value, ctx, values);
  if (problem) {
    return problem;
  }
  const choices = field.choices?.(ctx, values);
  return choices && !field.allowCustom && !choices.includes(value)
    ? `${field.label} must be one of: ${choices.join(", ")}`
    : undefined;
}

/**
 * Every field's value, taken from `given` or its default, in order so later
 * defaults can depend on earlier values. Throws, with a message for the user,
 * at the first missing or invalid value.
 */
export function resolveAddValues(noun: AddNoun, ctx: AddContext, given: AddValues): AddValues {
  const values: Record<string, string> = {};
  for (const field of noun.fields) {
    const value = given[field.key] ?? field.defaultValue?.(ctx, values);
    if (value === undefined) {
      throw new Error(`${field.label} is required`);
    }
    const problem = fieldProblem(field, value, ctx, values);
    if (problem) {
      throw new Error(problem);
    }
    values[field.key] = value;
  }
  return values;
}

/** One step of asking for a noun's values. */
export interface AddStep {
  field: AddField;
  /** 0-based. */
  index: number;
  total: number;
  /** What to start with: the user's earlier answer, or the default. */
  value: string | undefined;
  choices: readonly string[] | undefined;
  problem(value: string): string | undefined;
}

/** Answer to a step that returns to the one before it. */
export const stepBack = Symbol("stepBack");

/** Answers a step, or returns undefined to cancel. */
export type AddPrompt = (step: AddStep) => Promise<string | typeof stepBack | undefined>;

/**
 * Asks for each of a noun's values in turn, or returns undefined if the user
 * cancels. Going back keeps answers the user changed, and recomputes defaults
 * they left alone, since those can depend on the answers before them.
 * `seed` gives first values to offer in place of defaults.
 */
export async function collectAddValues(
  noun: AddNoun,
  ctx: AddContext,
  prompt: AddPrompt,
  seed: AddValues = {}
): Promise<AddValues | undefined> {
  const answers: Record<string, string> = {};
  const offered: Record<string, string | undefined> = {};
  let index = 0;
  while (index < noun.fields.length) {
    const field = noun.fields[index];
    const earlier = Object.fromEntries(noun.fields.slice(0, index).map((f) => [f.key, answers[f.key]]));
    const fallback = seed[field.key] ?? field.defaultValue?.(ctx, earlier);
    const changed = field.key in answers && answers[field.key] !== offered[field.key];
    const answer = await prompt({
      field,
      index,
      total: noun.fields.length,
      value: changed ? answers[field.key] : fallback,
      choices: field.choices?.(ctx, earlier),
      problem: (value) => fieldProblem(field, value, ctx, earlier),
    });
    if (answer === undefined) {
      return undefined;
    }
    if (answer === stepBack) {
      index = Math.max(0, index - 1);
      continue;
    }
    answers[field.key] = answer;
    offered[field.key] = fallback;
    index++;
  }
  return answers;
}
