import { styleText } from "node:util";
import { runRenameAssessmentSets, runRenameTags } from "./renameCourseNames";
import { run as runRenameQids } from "./renameQids";
import { CliRuntime, processRuntime } from "./runtime";

const USAGE = `Usage: prairielearn-navigator rename <subcommand> [options]

Subcommands:
  qid             Preview or write semantic QID reference updates
  tag             Preview or write a rename of a tag defined in infoCourse.json
  assessment-set  Preview or write a rename of an assessment set defined in
                  infoCourse.json

Run 'prairielearn-navigator rename <subcommand> --help' for subcommand-specific
help.`;

export async function run(
  args: string[],
  runtime: CliRuntime = processRuntime()
): Promise<number> {
  const subcommand = args[0];

  switch (subcommand) {
    case "qid":
      return runRenameQids(args.slice(1), runtime);
    case "tag":
      return runRenameTags(args.slice(1), runtime);
    case "assessment-set":
      return runRenameAssessmentSets(args.slice(1), runtime);
    case "--help":
    case "-h":
      runtime.stdout(USAGE);
      return 0;
    case undefined:
      runtime.stdout(USAGE);
      return 1;
    default:
      runtime.stderr(styleText("red", `Unknown rename subcommand: ${subcommand}`));
      runtime.stderr('Run "prairielearn-navigator rename --help" for usage.');
      return 1;
  }
}
