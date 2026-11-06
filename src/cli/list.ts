import * as path from "node:path";
import { assessmentId, courseAssessments } from "../core/assessments";
import { courseFiles, courseRelativePath, matchesGlob } from "../core/courseFiles";
import { today } from "../core/plVersion";
import { indexCourse, ReferenceIndex, UsedNames } from "../core/referenceIndex";
import { resolveCourseRoot } from "./edits";
import { CliRuntime, processRuntime } from "./runtime";

const INCLUDE_UNDEFINED_OPTION = `  --include-undefined  Also list names the course uses but infoCourse.json does
                       not define. "rename" does not accept these.
`;

function usage(noun: string, description: string, nameOptions = ""): string {
  return `Usage: prairielearn-navigator ${noun} list [options]

${description}

Options:
  --course <path>      A PrairieLearn course or path inside one (default: .)
  --json               Print a JSON array instead of one item per line
${nameOptions}  --help               Show this help message

Examples:
  prairielearn-navigator ${noun} list
  prairielearn-navigator ${noun} list --course path/to/course
  prairielearn-navigator ${noun} list --json`;
}

/** One listed item: its line of text output, and its `--json` element. */
interface Row {
  line: string;
  json: object;
}

/** A row listing a file, which is absolute. */
export interface FileRow extends Row {
  file: string;
}

interface ListArgs {
  course: string;
  json: boolean;
  includeUndefined: boolean;
}

function parseArgs(args: string[], listsNames: boolean): ListArgs | string {
  let course = ".";
  let json = false;
  let includeUndefined = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--include-undefined" && listsNames) {
      includeUndefined = true;
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
    return `Unexpected argument: ${arg}`;
  }
  return { course, json, includeUndefined };
}

export function questionRows(index: ReferenceIndex): FileRow[] {
  return index
    .files()
    .filter((file) =>
      matchesGlob(courseRelativePath(index.courseRoot, file), courseFiles.question)
    )
    .map((file) => {
      const qid = courseRelativePath(
        path.join(index.courseRoot, "questions"),
        path.dirname(file)
      );
      return { file, line: qid, json: { qid, tags: index.namesIn(file)?.tags ?? [] } };
    });
}

export function assessmentRows(index: ReferenceIndex): FileRow[] {
  return courseAssessments(index).map((item) => {
    const { file, instance, assessment } = item;
    return {
      file,
      line: assessmentId(item),
      json: { instance, assessment, set: index.namesIn(file)?.assessmentSets[0] ?? null },
    };
  });
}

/** Names of this kind that infoCourse.json defines, and optionally those only used. */
function nameRows(
  index: ReferenceIndex,
  kind: keyof UsedNames,
  includeUndefined: boolean
): Row[] {
  const defined = index.namesDefined(kind);
  const used = index.namesUsed(kind);
  const names = includeUndefined ? new Set([...defined, ...used]) : defined;
  return [...names].map((name) => ({
    line: name,
    json: { name, defined: defined.has(name), used: used.has(name) },
  }));
}

function compareLines(a: Row, b: Row): number {
  return a.line < b.line ? -1 : a.line > b.line ? 1 : 0;
}

async function run(
  usageText: string,
  rowsOf: (index: ReferenceIndex, includeUndefined: boolean) => Row[],
  listsNames: boolean,
  args: string[],
  runtime: CliRuntime
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    runtime.stdout(usageText);
    return 0;
  }

  const parsed = parseArgs(args, listsNames);
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
    const rows = rowsOf(indexCourse(courseRoot, today()), parsed.includeUndefined)
      .sort(compareLines);
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

export function runListQids(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  return run(usage("qid", "List question IDs."), questionRows, false, args, runtime);
}

export function runListAssessments(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const text = usage("assessment", "List assessments as <course-instance>/<assessment>.");
  return run(text, assessmentRows, false, args, runtime);
}

export function runListTags(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const text = usage("tag", "List tags defined in infoCourse.json.", INCLUDE_UNDEFINED_OPTION);
  return run(
    text,
    (index, includeUndefined) => nameRows(index, "tags", includeUndefined),
    true,
    args,
    runtime
  );
}

export function runListAssessmentSets(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const text = usage(
    "assessment-set",
    "List assessment sets defined in infoCourse.json.",
    INCLUDE_UNDEFINED_OPTION
  );
  return run(
    text,
    (index, includeUndefined) => nameRows(index, "assessmentSets", includeUndefined),
    true,
    args,
    runtime
  );
}
