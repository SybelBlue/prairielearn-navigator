import * as fs from "node:fs";
import * as path from "node:path";
import { findCourseNameReferences } from "../core/courseNameRenames";
import { assessmentSetKind, NameKind, tagKind } from "../core/courseNames";
import { courseFiles, relativeIdProblem } from "../core/courseFiles";
import { today } from "../core/plVersion";
import { indexCourse, ReferenceIndex } from "../core/referenceIndex";
import { resolveCourseRoot } from "./edits";
import { CliRuntime, processRuntime } from "./runtime";

interface UsesArgs {
  course: string;
  json: boolean;
  target: string;
}

interface Occurrence {
  file: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
}

type UsesFinder = (index: ReferenceIndex, target: string) => Occurrence[];

function usage(noun: string, argument: string, description: string, example: string): string {
  return `Usage: prairielearn-navigator ${noun} uses [options] <${argument}>

${description}

Options:
  --course <path>   A PrairieLearn course or path inside one (default: .)
  --json            Print a JSON array of locations instead of one location
                    per line
  --help            Show this help message

Examples:
  prairielearn-navigator ${noun} uses ${example}
  prairielearn-navigator ${noun} uses --json --course path/to/course ${example}`;
}

function parseArgs(args: string[], argument: string): UsesArgs | string {
  let course = ".";
  let json = false;
  const targets: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--course" || arg.startsWith("--course=")) {
      const value = arg === "--course" ? args[++i] : arg.slice("--course=".length);
      if (!value) {
        return "Missing value for --course";
      }
      course = value;
      continue;
    }
    if (arg.startsWith("-")) {
      return `Unknown option: ${arg}`;
    }
    targets.push(arg);
  }

  if (targets.length !== 1) {
    return `Exactly one ${argument} is required`;
  }
  return { course, json, target: targets[0] };
}

/** Semantic QID references, including references to a question that does not exist. */
const qidUses: UsesFinder = (index, qid) => {
  const problem = relativeIdProblem("QID", qid);
  if (problem) {
    throw new Error(problem);
  }
  const target = path.join(index.courseRoot, "questions", ...qid.split("/"));
  return index
    .usesOf(target)
    .filter((use) => use.ref.spec.target === "question" && use.ref.target === target);
};

/** Uses of a tag or assessment set that infoCourse.json defines. */
function nameUses(kind: NameKind): UsesFinder {
  return (index, name) => {
    const readText = (file: string) => {
      try {
        return fs.readFileSync(file, "utf-8");
      } catch {
        return undefined;
      }
    };
    const { definitions, uses } = findCourseNameReferences(kind, index, name, readText);
    if (definitions.length === 0) {
      const noun = kind.noun[0].toUpperCase() + kind.noun.slice(1);
      throw new Error(`${noun} "${name}" is not defined in ${courseFiles.course}`);
    }
    return uses;
  };
}

function compareOccurrences(a: Occurrence, b: Occurrence): number {
  return a.file.localeCompare(b.file) ||
    a.start.line - b.start.line ||
    a.start.column - b.start.column;
}

async function run(
  usageText: string,
  argument: string,
  findUses: UsesFinder,
  args: string[],
  runtime: CliRuntime
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    runtime.stdout(usageText);
    return 0;
  }

  const parsed = parseArgs(args, argument);
  if (typeof parsed === "string") {
    runtime.stderr(parsed);
    runtime.stderr(usageText);
    return 1;
  }

  let courseRoot: string | null;
  try {
    courseRoot = resolveCourseRoot(parsed.course, runtime.cwd);
  } catch (error) {
    runtime.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (!courseRoot) {
    runtime.stderr(`No PrairieLearn course found for ${path.resolve(runtime.cwd, parsed.course)}`);
    return 1;
  }

  try {
    const uses = findUses(indexCourse(courseRoot, today()), parsed.target)
      .sort(compareOccurrences);
    const rows = uses.map(({ file, start, end }) => {
      const shown = path.relative(runtime.cwd, file) || file;
      return {
        line: `${shown}:${start.line}:${start.column}`,
        json: {
          path: shown,
          lineSpan: [start.line, end.line],
          colSpan: [start.column, end.column],
        },
      };
    });
    if (parsed.json) {
      runtime.stdout(JSON.stringify(rows.map((row) => row.json), null, 2));
    } else {
      rows.forEach((row) => runtime.stdout(row.line));
    }
    return 0;
  } catch (error) {
    runtime.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function runUsesQid(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const text = usage(
    "qid",
    "qid",
    `List every assessment question, alternative, and question template that
references a QID. The referenced question does not need to exist.`,
    "topic/nested"
  );
  return run(text, "qid", qidUses, args, runtime);
}

export function runUsesTag(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const text = usage(
    "tag",
    "tag",
    `List every question that uses a tag defined in infoCourse.json. Fails if
infoCourse.json does not define it.`,
    "homework"
  );
  return run(text, "tag", nameUses(tagKind), args, runtime);
}

export function runUsesAssessmentSet(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const text = usage(
    "assessment-set",
    "assessment-set",
    `List every assessment that uses an assessment set defined in
infoCourse.json. Fails if infoCourse.json does not define it.`,
    "Homework"
  );
  return run(text, "assessment set", nameUses(assessmentSetKind), args, runtime);
}
