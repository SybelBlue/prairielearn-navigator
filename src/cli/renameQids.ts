import * as path from "node:path";
import { prepareFileChanges } from "../core/fileEdits";
import { today } from "../core/plVersion";
import { planQidReferenceRenames, QidRename } from "../core/qidRenames";
import { indexCourse } from "../core/referenceIndex";
import { displayEdit, resolveCourseRoot, writeChanges } from "./edits";
import { CliRuntime, processRuntime } from "./runtime";

const USAGE = `Usage: prairielearn-navigator qid rename [options] <old-qid> <new-qid> [<old-qid> <new-qid> ...]

Update every semantic reference to one or more PrairieLearn question IDs.
This command changes references only; it never moves question directories.

Arguments:
  old-qid new-qid   One or more pairs of QIDs to rename

Options:
  --course <path>   A PrairieLearn course or path inside one (default: .)
  --write           Write the planned changes. Without this flag, only preview
                    them.
  --help            Show this help message

Examples:
  prairielearn-navigator qid rename old new
  prairielearn-navigator qid rename --course path/to/course old new
  prairielearn-navigator qid rename a b topic/one unit/one
  prairielearn-navigator qid rename --write old new`;

interface RenameQidsArgs {
  course: string;
  write: boolean;
  renames: QidRename[];
}

function parseArgs(args: string[]): RenameQidsArgs | string {
  let course = ".";
  let write = false;
  const qids: string[] = [];

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
    qids.push(arg);
  }

  if (qids.length === 0) {
    return "At least one old/new QID pair is required";
  }
  if (qids.length % 2 !== 0) {
    return "QIDs must be provided as old/new pairs";
  }
  const renames: QidRename[] = [];
  for (let i = 0; i < qids.length; i += 2) {
    renames.push({ oldQid: qids[i], newQid: qids[i + 1] });
  }
  return { course, write, renames };
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
    const edits = planQidReferenceRenames(index, parsed.renames);
    if (edits.length === 0) {
      runtime.stdout("No semantic QID references matched.");
      return 0;
    }

    // Validate every source range before reporting or writing any changes.
    const changes = prepareFileChanges(edits);
    edits.forEach((edit) => runtime.stdout(displayEdit(edit, runtime.cwd)));
    if (!parsed.write) {
      runtime.stdout(
        `Would update ${edits.length} ${edits.length === 1 ? "reference" : "references"} in ${changes.length} ${changes.length === 1 ? "file" : "files"}. Rerun with --write to apply these changes.`
      );
      return 0;
    }

    writeChanges(changes);
    runtime.stdout(
      `Updated ${edits.length} ${edits.length === 1 ? "reference" : "references"} in ${changes.length} ${changes.length === 1 ? "file" : "files"}.`
    );
    return 0;
  } catch (error) {
    runtime.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
