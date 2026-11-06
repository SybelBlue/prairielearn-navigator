import { styleText } from "node:util";
import { addNouns } from "../core/additions";
import { addCommand } from "./add";
import {
  runListAssessments,
  runListAssessmentSets,
  runListQids,
  runListTags,
} from "./list";
import {
  runLocateAssessment,
  runLocateAssessmentSet,
  runLocateQid,
  runLocateTag,
} from "./locate";
import { run as runRenameAssessment } from "./renameAssessments";
import { runRenameAssessmentSets, runRenameTags } from "./renameCourseNames";
import { run as runRenameQids } from "./renameQids";
import { removeNouns } from "../core/removals";
import { removeCommand } from "./remove";
import { CliRuntime } from "./runtime";
import { runUsesAssessmentSet, runUsesQid, runUsesTag } from "./uses";

type Runner = (args: string[], runtime?: CliRuntime) => Promise<number>;

interface Subcommand {
  summary: string;
  run: Runner;
}

/** Runs one of a noun's subcommands, as `<noun> <subcommand> [options]`. */
function nounCommand(noun: string, subcommands: Record<string, Subcommand>) {
  const names = Object.keys(subcommands);
  const width = Math.max(...names.map((name) => name.length));
  const usage = `Usage: prairielearn-navigator ${noun} <subcommand> [options]

Subcommands:
${names.map((name) => `  ${name.padEnd(width)}  ${subcommands[name].summary}`).join("\n")}

Run 'prairielearn-navigator ${noun} <subcommand> --help' for details.`;

  return async (args: string[], runtime: CliRuntime): Promise<number> => {
    const subcommand = args[0];
    switch (subcommand) {
      case "--help":
      case "-h":
        runtime.stdout(usage);
        return 0;
      case undefined:
        runtime.stdout(usage);
        return 1;
    }
    if (!Object.hasOwn(subcommands, subcommand)) {
      runtime.stderr(styleText("red", `Unknown ${noun} subcommand: ${subcommand}`));
      runtime.stderr(`Run "prairielearn-navigator ${noun} --help" for usage.`);
      return 1;
    }
    return subcommands[subcommand].run(args.slice(1), runtime);
  };
}

/** Commands named for what they act on, each with subcommands for what to do. */
export const NOUN_COMMANDS: ReadonlyMap<
  string,
  (args: string[], runtime: CliRuntime) => Promise<number>
> = new Map([
  [
    "qid",
    nounCommand("qid", {
      add: { summary: "Preview or write a new question", run: addCommand("qid", addNouns.qid) },
      list: { summary: "List question IDs", run: runListQids },
      locate: { summary: "Print the path of a question's info.json", run: runLocateQid },
      remove: { summary: "Preview or remove a question and its references", run: removeCommand("qid", removeNouns.qid) },
      rename: { summary: "Preview or write semantic QID reference updates", run: runRenameQids },
      uses: { summary: "List semantic references to a question ID", run: runUsesQid },
    }),
  ],
  [
    "tag",
    nounCommand("tag", {
      add: { summary: "Preview or write a new tag in infoCourse.json", run: addCommand("tag", addNouns.tag) },
      list: { summary: "List tags defined in infoCourse.json", run: runListTags },
      locate: { summary: "Print where infoCourse.json defines a tag", run: runLocateTag },
      remove: { summary: "Preview or remove a tag and its references", run: removeCommand("tag", removeNouns.tag) },
      rename: {
        summary: "Preview or write a rename of a tag defined in infoCourse.json",
        run: runRenameTags,
      },
      uses: { summary: "List references to a tag", run: runUsesTag },
    }),
  ],
  [
    "assessment-set",
    nounCommand("assessment-set", {
      add: {
        summary: "Preview or write a new assessment set in infoCourse.json",
        run: addCommand("assessment-set", addNouns["assessment-set"]),
      },
      list: {
        summary: "List assessment sets defined in infoCourse.json",
        run: runListAssessmentSets,
      },
      locate: {
        summary: "Print where infoCourse.json defines an assessment set",
        run: runLocateAssessmentSet,
      },
      remove: {
        summary: "Preview or remove an assessment set and its references",
        run: removeCommand("assessment-set", removeNouns["assessment-set"]),
      },
      rename: {
        summary: "Preview or write a rename of an assessment set defined in infoCourse.json",
        run: runRenameAssessmentSets,
      },
      uses: { summary: "List references to an assessment set", run: runUsesAssessmentSet },
    }),
  ],
  [
    "assessment",
    nounCommand("assessment", {
      add: { summary: "Preview or write a new assessment", run: addCommand("assessment", addNouns.assessment) },
      list: { summary: "List assessments", run: runListAssessments },
      locate: {
        summary: "Print the path of an assessment's infoAssessment.json",
        run: runLocateAssessment,
      },
      remove: {
        summary: "Preview or remove an assessment and its suppressions",
        run: removeCommand("assessment", removeNouns.assessment),
      },
      rename: {
        summary: "Preview or write a rename of an assessment's directory",
        run: runRenameAssessment,
      },
    }),
  ],
]);
