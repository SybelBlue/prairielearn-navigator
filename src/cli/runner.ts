import { styleText } from "node:util";
import { run as runCheck } from "./check";
import { NOUN_COMMANDS } from "./nouns";
import { CliRuntime, processRuntime } from "./runtime";

/** The published package's version, from webpack.config.js or vitest.config.mts. */
declare const __CLI_VERSION__: string;

const USAGE = `Usage: prairielearn-navigator <command> [options]

Commands:
  check           Check a course's JSON files against PrairieLearn's schemas and rules
  qid             List, locate, or rename question IDs
  tag             List, locate, or rename tags
  assessment-set  List, locate, or rename assessment sets
  assessment      List, locate, or rename assessments

Options:
  -h, --help      Show this help message
  -v, --version   Print the version number

Run 'prairielearn-navigator <command> --help' for command-specific help.`;

// Remove in 1.4.0, along with the note in packages/cli/README.md.
const DEPRECATED_COMMANDS = new Map([
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

  const deprecatedNoun = DEPRECATED_COMMANDS.get(command);
  if (deprecatedNoun) {
    runtime.stderr(
      styleText(
        "yellow",
        `Warning: "${command}" is deprecated and will be removed in 1.4.0. Use "${deprecatedNoun} rename" instead.`
      )
    );
    return run([deprecatedNoun, "rename", ...args.slice(1)], runtime);
  }

  const nounCommand = NOUN_COMMANDS.get(command);
  if (nounCommand) {
    return nounCommand(args.slice(1), runtime);
  }

  switch (command) {
    case "check":
      return runCheck(args.slice(1), runtime);
    case "--help":
    case "-h":
      runtime.stdout(USAGE);
      return 0;
    case "--version":
    case "-v":
      runtime.stdout(__CLI_VERSION__);
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
