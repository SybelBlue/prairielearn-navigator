import { styleText } from "node:util";
import { run as runCheck } from "./check";

const USAGE = `Usage: prairielearn-navigator <command> [options]

Commands:
  check   Check a course's JSON files against PrairieLearn's schemas and rules

Run 'prairielearn-navigator <command> --help' for command-specific help.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "check":
      process.exit(await runCheck(args.slice(1)));
      break;
    case "--help":
    case "-h":
    case undefined:
      console.log(USAGE);
      process.exit(command ? 0 : 1);
      break;
    default:
      console.error(styleText("red", `Unknown command: ${command}`));
      console.error('Run "prairielearn-navigator --help" for usage.');
      process.exit(1);
  }
}

main();
