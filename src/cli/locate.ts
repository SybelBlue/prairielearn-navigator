import * as fs from "node:fs";
import * as path from "node:path";
import { courseFiles } from "../core/courseFiles";
import { assessmentSetKind, NameKind, tagKind } from "../core/courseNames";
import { offsetToPosition } from "../core/diagnostic";
import { parseJsonDoc } from "../core/json";
import { today } from "../core/plVersion";
import { indexCourse, ReferenceIndex } from "../core/referenceIndex";
import { resolveCourseRoot } from "./edits";
import { assessmentRows, FileRow, questionRows } from "./list";
import { CliRuntime, processRuntime } from "./runtime";

function usage(noun: string, argument: string, description: string, example: string): string {
  return `Usage: prairielearn-navigator ${noun} locate [options] <${argument}>

${description}

Options:
  --course <path>   A PrairieLearn course or path inside one (default: .)
  --json            Print a JSON object with "path" and, when known, "lineSpan"
                    and "colSpan"
  --help            Show this help message

Examples:
  prairielearn-navigator ${noun} locate ${example}
  prairielearn-navigator ${noun} locate --json --course path/to/course ${example}`;
}

/** Where something is defined. Spans are 1-based, and the end of `colSpan` is exclusive. */
interface Location {
  file: string;
  lineSpan?: [number, number];
  colSpan?: [number, number];
}

type Locator = (courseRoot: string, target: string) => Location;

interface LocateArgs {
  course: string;
  json: boolean;
  target: string;
}

function parseArgs(args: string[], argument: string): LocateArgs | string {
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

/** Locates a name by its definition in infoCourse.json. */
function nameLocator(kind: NameKind): Locator {
  return (courseRoot, name) => {
    const file = path.join(courseRoot, courseFiles.course);
    const text = fs.readFileSync(file, "utf-8");
    const definition = kind.definitions(parseJsonDoc(text)).find((d) => d.name === name);
    if (!definition) {
      const noun = kind.noun[0].toUpperCase() + kind.noun.slice(1);
      throw new Error(`${noun} "${name}" is not defined in ${courseFiles.course}`);
    }
    const start = offsetToPosition(text, definition.nameStart);
    const end = offsetToPosition(text, definition.nameEnd);
    return {
      file,
      lineSpan: [start.line, end.line],
      colSpan: [start.column, end.column],
    };
  };
}

/** Locates a file by the line `list` prints for it. */
function fileLocator(noun: string, rowsOf: (index: ReferenceIndex) => FileRow[]): Locator {
  return (courseRoot, target) => {
    const matches = rowsOf(indexCourse(courseRoot, today())).filter((row) => row.line === target);
    if (matches.length === 0) {
      throw new Error(`${noun} "${target}" is not defined`);
    }
    if (matches.length > 1) {
      const files = matches.map((row) => row.file).join(", ");
      throw new Error(`${noun} "${target}" is ambiguous: ${files}`);
    }
    return { file: matches[0].file };
  };
}

async function run(
  usageText: string,
  argument: string,
  locate: Locator,
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
    runtime.stderr(
      `No PrairieLearn course found for ${path.resolve(runtime.cwd, parsed.course)}`
    );
    return 1;
  }

  try {
    const { file, lineSpan, colSpan } = locate(courseRoot, parsed.target);
    const shown = path.relative(runtime.cwd, file) || file;
    if (parsed.json) {
      runtime.stdout(JSON.stringify({ path: shown, lineSpan, colSpan }, null, 2));
    } else {
      runtime.stdout(lineSpan && colSpan ? `${shown}:${lineSpan[0]}:${colSpan[0]}` : shown);
    }
    return 0;
  } catch (error) {
    runtime.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function runLocateQid(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const text = usage(
    "qid",
    "qid",
    "Print the path of a question's info.json. Fails if there is no such question.",
    "topic/nested"
  );
  return run(text, "qid", fileLocator("Question", questionRows), args, runtime);
}

export function runLocateAssessment(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const text = usage(
    "assessment",
    "assessment",
    `Print the path of an assessment's infoAssessment.json. The assessment is named
as "assessment list" prints it. Fails if there is no such assessment.`,
    "Fa26/hw1"
  );
  return run(text, "assessment", fileLocator("Assessment", assessmentRows), args, runtime);
}

export function runLocateTag(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const text = usage(
    "tag",
    "tag",
    `Print where infoCourse.json defines a tag, as path:line:column. Fails if
infoCourse.json does not define it.`,
    "homework"
  );
  return run(text, "tag", nameLocator(tagKind), args, runtime);
}

export function runLocateAssessmentSet(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const text = usage(
    "assessment-set",
    "assessment-set",
    `Print where infoCourse.json defines an assessment set, as path:line:column.
Fails if infoCourse.json does not define it.`,
    "Homework"
  );
  return run(text, "assessment set", nameLocator(assessmentSetKind), args, runtime);
}
