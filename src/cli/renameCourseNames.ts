import * as fs from "node:fs";
import * as path from "node:path";
import { planCourseNameRename } from "../core/courseNameRenames";
import { assessmentSetKind, NameKind, tagKind } from "../core/courseNames";
import { prepareFileChanges } from "../core/fileEdits";
import { today } from "../core/plVersion";
import { indexCourse } from "../core/referenceIndex";
import { displayEdit, plural, resolveCourseRoot, writeChanges } from "./edits";
import { CliRuntime, processRuntime } from "./runtime";

const RENAME_TAGS_USAGE = `Usage: prairielearn-navigator rename-tags [options] <old-tag> <new-tag>

Rename a tag defined in infoCourse.json: its definition, every question's
"tags" entry, and diagnostic suppressions in .pl-navigator.jsonc that name it.

Arguments:
  old-tag           A tag defined in infoCourse.json
  new-tag           Its new name, which infoCourse.json must not already define

Options:
  --course <path>   A PrairieLearn course or path inside one (default: .)
  --write           Write the planned changes. Without this flag, only preview
                    them.
  --help            Show this help message

Examples:
  prairielearn-navigator rename-tags hw homework
  prairielearn-navigator rename-tags --write --course path/to/course hw homework`;

const RENAME_ASSESSMENT_SETS_USAGE = `Usage: prairielearn-navigator rename-assessment-sets [options] <old-set> <new-set>

Rename an assessment set defined in infoCourse.json: its definition, every
assessment's "set", and diagnostic suppressions in .pl-navigator.jsonc that
name it.

Arguments:
  old-set           An assessment set defined in infoCourse.json
  new-set           Its new name, which infoCourse.json must not already define

Options:
  --course <path>   A PrairieLearn course or path inside one (default: .)
  --write           Write the planned changes. Without this flag, only preview
                    them.
  --help            Show this help message

Examples:
  prairielearn-navigator rename-assessment-sets HW Homework
  prairielearn-navigator rename-assessment-sets --write --course path/to/course "Quiz" "Practice Quiz"`;

interface RenameArgs {
  course: string;
  write: boolean;
  oldName: string;
  newName: string;
}

function parseArgs(args: string[], kind: NameKind): RenameArgs | string {
  let course = ".";
  let write = false;
  const names: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--write") {
      write = true;
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
    names.push(arg);
  }

  if (names.length !== 2) {
    return `Exactly one old ${kind.noun} and one new ${kind.noun} are required`;
  }
  return { course, write, oldName: names[0], newName: names[1] };
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
}

async function run(
  kind: NameKind,
  usage: string,
  args: string[],
  runtime: CliRuntime
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    runtime.stdout(usage);
    return 0;
  }

  const parsed = parseArgs(args, kind);
  if (typeof parsed === "string") {
    runtime.stderr(parsed);
    runtime.stderr(usage);
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
    const index = indexCourse(courseRoot, today());
    const edits = planCourseNameRename(kind, index, parsed.oldName, parsed.newName, readText);
    // Validate every source range before reporting or writing any changes.
    const changes = prepareFileChanges(edits);
    edits.forEach((edit) => runtime.stdout(displayEdit(edit, runtime.cwd)));
    const summary = `${plural(edits.length, "edit")} in ${plural(changes.length, "file")}`;
    if (!parsed.write) {
      runtime.stdout(`Would make ${summary}. Rerun with --write to apply these changes.`);
      return 0;
    }
    writeChanges(changes);
    runtime.stdout(`Made ${summary}.`);
    return 0;
  } catch (error) {
    runtime.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function runRenameTags(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  return run(tagKind, RENAME_TAGS_USAGE, args, runtime);
}

export function runRenameAssessmentSets(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  return run(assessmentSetKind, RENAME_ASSESSMENT_SETS_USAGE, args, runtime);
}
