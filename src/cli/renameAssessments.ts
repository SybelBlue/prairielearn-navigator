import * as fs from "node:fs";
import * as path from "node:path";
import { planAssessmentRename } from "../core/assessments";
import { removeEmptyParents } from "../core/emptyDirs";
import { prepareFileChanges } from "../core/fileEdits";
import { today } from "../core/plVersion";
import { indexCourse } from "../core/referenceIndex";
import { displayEdit, plural, resolveCourseRoot, writeChanges } from "./edits";
import { CliRuntime, processRuntime } from "./runtime";

const USAGE = `Usage: prairielearn-navigator assessment rename [options] <old-assessment> <new-assessment>

Rename an assessment within its course instance: move its directory, remove
directories that leaves empty, and update diagnostic suppressions in
.pl-navigator.jsonc that name files in it.

Arguments:
  old-assessment    An assessment, as "assessment list" prints it
  new-assessment    Its new name, in the same course instance

Options:
  --course <path>   A PrairieLearn course or path inside one (default: .)
  --write           Move the directory and write the planned changes. Without
                    this flag, only preview them.
  --help            Show this help message

Examples:
  prairielearn-navigator assessment rename Fa26/hw1 Fa26/homework1
  prairielearn-navigator assessment rename --write Fa26/hw1 Fa26/unit1/hw1`;

interface RenameArgs {
  course: string;
  write: boolean;
  oldId: string;
  newId: string;
}

function parseArgs(args: string[]): RenameArgs | string {
  let course = ".";
  let write = false;
  const ids: string[] = [];

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
    ids.push(arg);
  }

  if (ids.length !== 2) {
    return "Exactly one old assessment and one new assessment are required";
  }
  return { course, write, oldId: ids[0], newId: ids[1] };
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
}

export async function run(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    runtime.stdout(USAGE);
    return 0;
  }

  const parsed = parseArgs(args);
  if (typeof parsed === "string") {
    runtime.stderr(parsed);
    runtime.stderr(USAGE);
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
    const { oldDir, newDir, assessmentsDir, emptiedDirs, edits } = planAssessmentRename(
      index,
      parsed.oldId,
      parsed.newId,
      readText
    );
    // Validate every source range before reporting or writing any changes.
    const changes = prepareFileChanges(edits);
    const shown = (dir: string) => path.relative(runtime.cwd, dir) || dir;
    runtime.stdout(`${shown(oldDir)} -> ${shown(newDir)}`);
    emptiedDirs.forEach((dir) => runtime.stdout(`Remove empty directory ${shown(dir)}`));
    edits.forEach((edit) => runtime.stdout(displayEdit(edit, runtime.cwd)));
    const summary = edits.length === 0
      ? "1 assessment"
      : `1 assessment and ${plural(edits.length, "edit")} in ${plural(changes.length, "file")}`;
    if (!parsed.write) {
      runtime.stdout(`Would rename ${summary}. Rerun with --write to apply these changes.`);
      return 0;
    }

    fs.mkdirSync(path.dirname(newDir), { recursive: true });
    fs.renameSync(oldDir, newDir);
    try {
      writeChanges(changes);
    } catch (error) {
      fs.renameSync(newDir, oldDir);
      removeEmptyParents(newDir, assessmentsDir);
      throw error;
    }
    removeEmptyParents(oldDir, assessmentsDir);
    runtime.stdout(`Renamed ${summary}.`);
    return 0;
  } catch (error) {
    runtime.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
