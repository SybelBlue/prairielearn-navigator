import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { removeEmptyParents } from "../core/emptyDirs";
import { FileChange, prepareFileChanges } from "../core/fileEdits";
import { today } from "../core/plVersion";
import { RemoveContext, RemoveNoun } from "../core/removals";
import { indexCourse } from "../core/referenceIndex";
import { displayEdit, openCourse, readText, writeChanges } from "./edits";
import { CliRuntime, processRuntime } from "./runtime";

interface RemoveArgs {
  course: string;
  write: boolean;
  updateReferences: boolean;
  replacement?: string;
  target: string;
}

const program = "prairielearn-navigator";

function usage(cliNoun: string, noun: RemoveNoun): string {
  const replacement = cliNoun === "assessment-set"
    ? "  --replacement <set>      Replace uses with another defined assessment set\n"
    : "";
  return `Usage: ${program} ${cliNoun} remove [options] <${noun.argument}>

${noun.description}

Arguments:
  ${noun.argument.padEnd(26)}  The ${noun.noun} to remove

Options:
  --course <path>           A PrairieLearn course or path inside one (default: .)
  --write                   Apply the removal. Without this flag, only preview it.
  --no-update-references    Leave additional references and suppressions unchanged
${replacement}  --help                    Show this help message

Examples:
${noun.examples.map((example) => `  ${program} ${example}`).join("\n")}`;
}

function parseArgs(cliNoun: string, noun: RemoveNoun, args: string[]): RemoveArgs | string {
  let course = ".";
  let write = false;
  let updateReferences = true;
  let replacement: string | undefined;
  const targets: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--no-update-references") {
      updateReferences = false;
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
    if (arg === "--replacement" || arg.startsWith("--replacement=")) {
      if (cliNoun !== "assessment-set") {
        return `Unknown option: ${arg}`;
      }
      const value = arg === "--replacement" ? args[++i] : arg.slice("--replacement=".length);
      if (!value) {
        return "Missing value for --replacement";
      }
      replacement = value;
      continue;
    }
    if (arg.startsWith("-")) {
      return `Unknown option: ${arg}`;
    }
    targets.push(arg);
  }
  if (targets.length !== 1) {
    return `Exactly one ${noun.argument} is required`;
  }
  if (!updateReferences && replacement !== undefined) {
    return "--replacement cannot be used with --no-update-references";
  }
  return { course, write, updateReferences, replacement, target: targets[0] };
}

function restoreChanges(changes: readonly FileChange[]): unknown[] {
  const errors: unknown[] = [];
  for (const change of changes) {
    try {
      fs.writeFileSync(change.file, change.original);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

/** Stages a directory move so file-edit failures can put it back. */
function removeDirectory(
  dir: string,
  root: string,
  changes: readonly FileChange[]
): void {
  const staged = path.join(
    path.dirname(dir),
    `.${path.basename(dir)}.pl-navigator-remove-${randomUUID()}`
  );
  fs.renameSync(dir, staged);
  let changesWritten = false;
  try {
    writeChanges(changes);
    changesWritten = true;
    fs.rmSync(staged, { recursive: true });
  } catch (error) {
    const rollbackErrors = changesWritten ? restoreChanges(changes) : [];
    try {
      if (fs.existsSync(staged)) {
        fs.renameSync(staged, dir);
      }
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
        `failed to roll back ${rollbackErrors.length} change(s)`
      );
    }
    throw error;
  }
  removeEmptyParents(dir, root);
}

/** The `remove` verb of a noun. */
export function removeCommand(cliNoun: string, noun: RemoveNoun) {
  return async (args: string[], runtime: CliRuntime = processRuntime()): Promise<number> => {
    if (args.includes("--help") || args.includes("-h")) {
      runtime.stdout(usage(cliNoun, noun));
      return 0;
    }
    const parsed = parseArgs(cliNoun, noun, args);
    if (typeof parsed === "string") {
      runtime.stderr(parsed);
      runtime.stderr(usage(cliNoun, noun));
      return 1;
    }
    const courseRoot = openCourse(parsed.course, runtime);
    if (!courseRoot) {
      return 1;
    }

    try {
      const ctx: RemoveContext = { index: indexCourse(courseRoot, today()), readText };
      const removal = noun.plan(ctx, parsed.target, parsed);
      const edits = [...removal.primaryEdits, ...removal.referenceEdits];
      const changes = prepareFileChanges(edits);
      const shown = (file: string) => path.relative(runtime.cwd, file) || file;

      runtime.stdout(`Remove ${removal.noun} ${removal.id}`);
      if (removal.directory) {
        runtime.stdout(`Remove directory ${shown(removal.directory.path)}`);
      }
      edits.forEach((fileEdit) => runtime.stdout(displayEdit(fileEdit, runtime.cwd)));
      if (!parsed.updateReferences) {
        runtime.stderr(
          "Warning: additional references will not be updated; this may leave dangling uses " +
          "or stale diagnostic suppressions."
        );
      }
      if (!parsed.write) {
        runtime.stdout(
          `Would remove 1 ${removal.noun}. Rerun with --write to apply these changes.`
        );
        return 0;
      }

      if (removal.directory) {
        removeDirectory(removal.directory.path, removal.directory.root, changes);
      } else {
        writeChanges(changes);
      }
      runtime.stdout(`Removed 1 ${removal.noun}.`);
      return 0;
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  };
}

