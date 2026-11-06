import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { AddContext, AddNoun, resolveAddValues } from "../core/additions";
import { prepareFileChanges } from "../core/fileEdits";
import { today } from "../core/plVersion";
import { indexCourse } from "../core/referenceIndex";
import { createFiles, displayEdit, openCourse, readText, writeChanges } from "./edits";
import { CliRuntime, processRuntime } from "./runtime";

interface AddArgs {
  course: string;
  write: boolean;
  given: Record<string, string>;
}

const program = "prairielearn-navigator";

function usage(cliNoun: string, noun: AddNoun): string {
  const [id, ...options] = noun.fields;
  const width = Math.max(...options.map((f) => f.key.length + 10), "--course <path>".length);
  return `Usage: ${program} ${cliNoun} add [options] <${id.key}>

${noun.description}

Arguments:
  ${id.key.padEnd(width)}  ${id.usage}

Options:
${options.map((field) => `  ${`--${field.key} <value>`.padEnd(width)}  ${field.usage}`).join("\n")}
  ${"--course <path>".padEnd(width)}  A PrairieLearn course or path inside one (default: .)
  ${"--write".padEnd(width)}  Write the planned changes. Without this flag, only preview them.
  ${"--help".padEnd(width)}  Show this help message

Examples:
${noun.examples.map((example) => `  ${program} ${example}`).join("\n")}`;
}

function parseArgs(noun: AddNoun, args: string[]): AddArgs | string {
  const [idField, ...options] = noun.fields;
  const flags = new Set(options.map((field) => field.key));
  let course = ".";
  let write = false;
  const given: Record<string, string> = {};
  const ids: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--write") {
      write = true;
      continue;
    }
    const [flag, inline] = arg.startsWith("--") && arg.includes("=")
      ? [arg.slice(2, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
      : [arg.slice(2), undefined];
    if (arg.startsWith("--") && (flag === "course" || flags.has(flag))) {
      const value = inline ?? args[++i];
      // `--title --write` means a forgotten title, not a title of "--write"
      if (value === undefined || (inline === undefined && value.startsWith("--"))) {
        return `Missing value for --${flag}`;
      }
      if (flag === "course") {
        course = value;
      } else {
        given[flag] = value;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      return `Unknown option: ${arg}`;
    }
    ids.push(arg);
  }

  if (ids.length !== 1) {
    return `Exactly one ${idField.label} is required`;
  }
  return { course, write, given: { ...given, [idField.key]: ids[0] } };
}

/** The `add` verb of a noun: its usage and flags come from the noun's fields. */
export function addCommand(cliNoun: string, noun: AddNoun) {
  return async (args: string[], runtime: CliRuntime = processRuntime()): Promise<number> => {
    if (args.includes("--help") || args.includes("-h")) {
      runtime.stdout(usage(cliNoun, noun));
      return 0;
    }

    const parsed = parseArgs(noun, args);
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
      const ctx: AddContext = { index: indexCourse(courseRoot, today()), readText };
      const values = resolveAddValues(noun, ctx, parsed.given);
      const addition = noun.plan(ctx, values, randomUUID());
      // Validate every source range before reporting or writing any changes.
      const changes = addition.kind === "edits" ? prepareFileChanges(addition.edits) : [];

      const [id, ...fields] = noun.fields;
      runtime.stdout(`${noun.noun} ${values[id.key]}`);
      fields.forEach((field) => runtime.stdout(`  ${field.key}: ${values[field.key]}`));
      if (addition.kind === "files") {
        const shown = (file: string) => path.relative(runtime.cwd, file) || file;
        addition.created.forEach(({ file }) => runtime.stdout(`Create ${shown(file)}`));
      } else {
        addition.edits.forEach((edit) => runtime.stdout(displayEdit(edit, runtime.cwd)));
      }
      addition.warnings.forEach((warning) => runtime.stderr(`Warning: ${warning}`));

      if (!parsed.write) {
        runtime.stdout(`Would add 1 ${noun.noun}. Rerun with --write to apply these changes.`);
        return 0;
      }
      if (addition.kind === "files") {
        createFiles(addition.created);
      } else {
        writeChanges(changes);
      }
      runtime.stdout(`Added 1 ${noun.noun}.`);
      return 0;
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  };
}
