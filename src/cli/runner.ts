import { styleText } from "node:util";
import { run as runCheck } from "./check";
import { run as runRename } from "./rename";
import { CliRuntime, processRuntime } from "./runtime";

const USAGE = `Usage: prairielearn-navigator <command> [options]

Commands:
  check         Check a course's JSON files against PrairieLearn's schemas and rules
  rename        Preview or write a rename of a QID, tag, or assessment set

Run 'prairielearn-navigator <command> --help' for command-specific help.`;

// Remove in 1.4.0, along with the note in packages/cli/README.md.
const DEPRECATED_RENAME_COMMANDS = new Map([
  ["rename-qids", "qid"],
  ["rename-tags", "tag"],
  ["rename-assessment-sets", "assessment-set"],
]);

/** Runs one CLI invocation without terminating the process. */
export async function run(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const command = args[0];

  const renameSubcommand = DEPRECATED_RENAME_COMMANDS.get(command);
  if (renameSubcommand) {
    runtime.stderr(
      styleText(
        "yellow",
        `Warning: "${command}" is deprecated and will be removed in 1.4.0. Use "rename ${renameSubcommand}" instead.`
      )
    );
    return runRename([renameSubcommand, ...args.slice(1)], runtime);
  }

  switch (command) {
    case "check":
      return runCheck(args.slice(1), runtime);
    case "rename":
      return runRename(args.slice(1), runtime);
    case "--help":
    case "-h":
      runtime.stdout(USAGE);
      return 0;
    case undefined:
      runtime.stdout(USAGE);
      return 1;
    default:
      runtime.stderr(styleText("red", `Unknown command: ${command}`));
      runtime.stderr('Run "prairielearn-navigator --help" for usage.');
      return 1;
  }
}
