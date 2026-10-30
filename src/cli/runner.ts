import { styleText } from "node:util";
import { run as runCheck } from "./check";
import { run as runRenameQids } from "./renameQids";
import { CliRuntime, processRuntime } from "./runtime";

const USAGE = `Usage: prairielearn-navigator <command> [options]

Commands:
  check         Check a course's JSON files against PrairieLearn's schemas and rules
  rename-qids   Preview or write semantic QID reference updates

Run 'prairielearn-navigator <command> --help' for command-specific help.`;

/** Runs one CLI invocation without terminating the process. */
export async function run(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const command = args[0];

  switch (command) {
    case "check":
      return runCheck(args.slice(1), runtime);
    case "rename-qids":
      return runRenameQids(args.slice(1), runtime);
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
