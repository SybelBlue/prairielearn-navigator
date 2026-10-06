import * as fs from "node:fs";
import * as path from "node:path";
import { styleText } from "node:util";
import {
  ConfigOverrides,
  ConfigProblem,
  LoadedConfig,
  loadConfig,
} from "../core/config";
import { findCourseRoot } from "../core/course";
import { courseRelativePath } from "../core/courseFiles";
import { Diagnostic, offsetToPosition } from "../core/diagnostic";
import { versionDate } from "../core/plVersion";
import { questionFilePathsFromId } from "../core/questionPaths";
import { findFileRefs, sourceOf } from "../core/references/extract";
import { isCheckable, runRules } from "../core/rules/run";
import { SchemaStore } from "../core/schemas";

// ── Types ──

interface CheckError {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: Diagnostic["severity"];
}

/** A question info.json verified while checking an assessment. */
interface CheckedQuestion {
  /** Absolute path to the question's info.json (which may not exist). */
  infoJson: string;
  hasError: boolean;
}

interface FileResult {
  errors: CheckError[];
  questions: CheckedQuestion[];
}

type Format = "pretty" | "github";

// ── Error collection ──

/** Config and schema store shared by every file of one course. */
interface CourseSetup {
  loaded: LoadedConfig;
  schemas: SchemaStore;
}

class Setups {
  private byCourse = new Map<string, CourseSetup>();
  private stores = new Map<string, SchemaStore>();

  constructor(
    private configPath: string | undefined,
    private overrides: ConfigOverrides
  ) {}

  get(courseRoot: string): CourseSetup {
    let setup = this.byCourse.get(courseRoot);
    if (!setup) {
      const loaded = loadConfig(courseRoot, {
        configPath: this.configPath,
        overrides: this.overrides,
      });
      const { schemaCacheDir } = loaded.config;
      let schemas = this.stores.get(schemaCacheDir);
      if (!schemas) {
        schemas = new SchemaStore({
          cacheDir: schemaCacheDir,
          githubToken: process.env.GITHUB_TOKEN,
        });
        this.stores.set(schemaCacheDir, schemas);
      }
      setup = { loaded, schemas };
      this.byCourse.set(courseRoot, setup);
    }
    return setup;
  }

  /** Config files that were read, with their problems. */
  configProblems(): Map<string, ConfigProblem[]> {
    const out = new Map<string, ConfigProblem[]>();
    for (const { loaded } of this.byCourse.values()) {
      if (loaded.file && loaded.problems.some((p) => p.file)) {
        out.set(
          loaded.file,
          loaded.problems.filter((p) => p.file)
        );
      }
    }
    return out;
  }

  schemaProblems(): string[] {
    return [...this.stores.values()].flatMap((s) => [...s.problems]);
  }
}

function toCheckError(
  d: Diagnostic,
  source: string,
  displayPath: string
): CheckError {
  const start = offsetToPosition(source, d.startOffset);
  const end = offsetToPosition(source, d.endOffset);
  const rule = d.code?.replace(/^prairielearn-navigator\//, "");
  return {
    file: displayPath,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    message: rule ? `${d.message} [${rule}]` : d.message,
    severity: d.severity,
  };
}

async function checkFile(
  file: string,
  courseId: string,
  displayPath: string,
  setup: CourseSetup
): Promise<FileResult> {
  const source = fs.readFileSync(file, "utf-8");
  const diagnostics = await runRules(file, source, {
    courseRoot: courseId,
    config: setup.loaded.config,
    schemas: setup.schemas,
  });
  const erroredIds = new Set(
    diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => source.slice(d.startOffset, d.endOffset))
  );
  const questionIds =
    path.basename(file) === ASSESSMENT_FILE
      ? findFileRefs(
          sourceOf(source),
          courseRelativePath(courseId, file),
          versionDate(setup.loaded.config.plVersion),
          { courseRoot: courseId, fileDir: path.dirname(file) },
          (spec) => spec.target === "question"
        ).map((ref) => ref.value)
      : [];
  const questions = [...new Set(questionIds)].map((localId) => ({
    infoJson: questionFilePathsFromId({ courseId, localId }).infoJson,
    hasError: erroredIds.has(localId),
  }));
  const errors = diagnostics.map((d) => toCheckError(d, source, displayPath));
  return { errors, questions };
}

function notInCourse(displayPath: string): FileResult {
  return {
    errors: [
      {
        file: displayPath,
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 1,
        message:
          "not inside a course (no infoCourse.json found in any parent directory); skipped",
        severity: "warning",
      },
    ],
    questions: [],
  };
}

// ── Formatting ──

function formatError(error: CheckError, source: string): string {
  const lines = source.split("\n");
  const errorLine = error.line - 1; // 0-based index

  const isWarning = error.severity === "warning";
  const color = isWarning ? "yellow" : "red";
  const header =
    styleText("bold", `${error.file}:${error.line}:${error.column}`) +
    " " +
    styleText(color, error.severity) +
    ": " +
    error.message;

  // Context lines: up to 2 before + the error line(s)
  const contextStart = Math.max(0, errorLine - 2);
  const contextEnd = Math.min(lines.length - 1, error.endLine - 1);

  const gutterWidth = String(contextEnd + 1).length;
  const pad = (n: number) => String(n).padStart(gutterWidth);

  const outputLines: string[] = [header];
  outputLines.push(styleText("dim", " ".repeat(gutterWidth) + " |"));

  for (let i = contextStart; i <= contextEnd; i++) {
    outputLines.push(styleText("dim", `${pad(i + 1)} |`) + " " + lines[i]);
  }

  // Underline: only on the last displayed line of the error
  const lastLine = lines[error.endLine - 1] || "";
  const [underlineStart, underlineEnd] =
    error.line === error.endLine
      ? [error.column - 1, error.endColumn - 1]
      : [0, lastLine.length];

  const underline =
    " ".repeat(underlineStart) +
    "^".repeat(Math.max(1, underlineEnd - underlineStart)) +
    " " +
    error.message;

  outputLines.push(
    styleText("dim", " ".repeat(gutterWidth) + " |") +
      " " +
      styleText(color, underline)
  );

  return outputLines.join("\n");
}

function escapeGithubData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeGithubProperty(s: string): string {
  return escapeGithubData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/** GitHub Actions workflow command, rendered as an inline PR annotation. */
function formatGithubAnnotation(error: CheckError): string {
  const props = [
    `file=${escapeGithubProperty(error.file)}`,
    `line=${error.line}`,
    `col=${error.column}`,
    `endLine=${error.endLine}`,
    `endColumn=${error.endColumn}`,
    `title=prairielearn-navigator`,
  ].join(",");
  return `::${error.severity} ${props}::${escapeGithubData(error.message)}`;
}

function formatSummary(
  totalErrors: number,
  filesWithErrors: number,
  totalFiles: number,
  totalQuestions: number,
  totalWarnings = 0
): string {
  const checked =
    `${totalFiles} ${totalFiles === 1 ? "file" : "files"}, ` +
    `${totalQuestions} ${totalQuestions === 1 ? "question" : "questions"} checked`;
  if (totalErrors === 0 && totalWarnings === 0) {
    return styleText("green", `No errors found (${checked})`);
  }
  const parts: string[] = [];
  if (totalErrors > 0) {
    const errStr = totalErrors === 1 ? "error" : "errors";
    parts.push(styleText("red", `${totalErrors} ${errStr}`));
  }
  if (totalWarnings > 0) {
    const warnStr = totalWarnings === 1 ? "warning" : "warnings";
    parts.push(styleText("yellow", `${totalWarnings} ${warnStr}`));
  }
  const errFileStr = filesWithErrors === 1 ? "file" : "files";
  const where = filesWithErrors > 0 ? ` in ${filesWithErrors} ${errFileStr}` : "";
  return `${parts.join(", ")}${where} (${checked})`;
}

// ── File resolution ──

const DEFAULT_EXCLUDE_SEGMENTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
];

const ASSESSMENT_FILE = "infoAssessment.json";
/** Basenames of every file a rule may apply to. */
const COURSE_FILES = [
  "infoCourse.json",
  "infoCourseInstance.json",
  ASSESSMENT_FILE,
  "info.json",
  "question.html",
];
/** Outside a course these are reported; a stray info.json or html is not. */
const COURSE_ONLY_FILES = ["infoCourseInstance.json", ASSESSMENT_FILE];
const COURSE_FILES_GLOB = `**/{${COURSE_FILES.join(",")}}`;

function isGlob(p: string): boolean {
  return /[*?[\]{}]/.test(p);
}

/**
 * Expands a glob to PrairieLearn JSON files: matched files are kept by
 * name, and matched directories are searched recursively.
 */
function expandGlob(pattern: string, cwd: string): string[] {
  const matches = fs.globSync(
    [pattern, `${pattern.replace(/\/+$/, "")}/${COURSE_FILES_GLOB}`],
    { cwd }
  );
  return matches
    .filter((m) => COURSE_FILES.includes(path.basename(m)))
    .map((m) => path.resolve(cwd, m));
}

function resolveFiles(paths: string[]): string[] {
  const files = new Set<string>();
  const cwd = process.cwd();
  for (const p of paths) {
    if (isGlob(p)) {
      for (const f of expandGlob(p, cwd)) {
        files.add(f);
      }
      continue;
    }
    const resolved = path.resolve(cwd, p);
    if (!fs.existsSync(resolved)) {
      continue;
    }
    if (fs.statSync(resolved).isDirectory()) {
      for (const match of fs.globSync(COURSE_FILES_GLOB, { cwd: resolved })) {
        files.add(path.resolve(resolved, match));
      }
    } else {
      files.add(resolved);
    }
  }
  return [...files]
    .filter((f) => !DEFAULT_EXCLUDE_SEGMENTS.some((seg) => f.includes(seg)))
    .sort();
}

/**
 * Pairs each file with its course root, dropping files no rule applies to.
 * Files outside any course map to null.
 */
function courseFilesOf(files: string[]): [string, string | null][] {
  const out: [string, string | null][] = [];
  const roots = new Map<string, string | null>();
  for (const file of files) {
    const courseRoot = findCourseRoot(file, roots);
    if (courseRoot === null) {
      if (COURSE_ONLY_FILES.includes(path.basename(file))) {
        out.push([file, null]);
      }
    } else if (isCheckable(courseRelativePath(courseRoot, file))) {
      out.push([file, courseRoot]);
    }
  }
  return out;
}

// ── Main ──

const USAGE = `Usage: prairielearn-navigator check [options] [paths...]

Check a PrairieLearn course's JSON files against PrairieLearn's schemas and
the navigator's rules: missing, incomplete, and duplicate questions, and
clientFilesCourse dependencies that do not exist.

Arguments:
  paths     Course directories to search, course JSON files, or glob
            patterns matching either (default: .). Quote globs so the shell
            does not expand them.

Options:
  --format <pretty|github>  Output format (default: pretty). "github" emits
                            GitHub Actions annotations.
  --config <path>           Config file (default: .pl-navigator.jsonc in each
                            course root)
  --pl-version <version>    PrairieLearn version to check against: "latest",
                            a date (YYYY-MM-DD), or a commit sha
  --schema-cache <dir>      Where downloaded schemas are cached
  --help                    Show this help message

Dated versions are resolved with the GitHub API; set GITHUB_TOKEN to avoid
its rate limit.

Exit status is 1 if any errors are found; warnings do not affect it.

Examples:
  prairielearn-navigator check
  prairielearn-navigator check path/to/course
  prairielearn-navigator check --pl-version 2025-06-01
  prairielearn-navigator check "courseInstances/Fa26/**"
  prairielearn-navigator check "**/assessments/hw*/infoAssessment.json"
  prairielearn-navigator check --format github`;

const VALUE_OPTIONS = ["--format", "--config", "--pl-version", "--schema-cache"];

/** Parses `--opt value` and `--opt=value` pairs; returns an error message on failure. */
function parseArgs(
  args: string[]
): { options: Record<string, string>; paths: string[] } | string {
  const options: Record<string, string> = {};
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("-")) {
      paths.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!VALUE_OPTIONS.includes(name)) {
      return `Unknown option: ${arg}`;
    }
    const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
    if (value === undefined) {
      return `Missing value for ${name}`;
    }
    options[name] = value;
  }
  return { options, paths };
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  const parsed = parseArgs(args);
  if (typeof parsed === "string") {
    console.error(styleText("red", parsed));
    console.error(USAGE);
    return 1;
  }
  const { options, paths } = parsed;
  const format = (options["--format"] ?? "pretty") as Format;
  if (format !== "pretty" && format !== "github") {
    console.error(styleText("red", `Invalid --format: ${format}`));
    return 1;
  }
  if (paths.length === 0) {
    paths.push(".");
  }

  const overrides: ConfigOverrides = {
    plVersion: options["--pl-version"],
    schemaCacheDir: options["--schema-cache"],
  };
  // Surface bad flags (and a missing --config) before doing any work
  const flagProblems = loadConfig(null, {
    configPath: options["--config"],
    overrides,
  }).problems.filter((p) => !p.file);
  if (flagProblems.length > 0) {
    flagProblems.forEach((p) => console.error(styleText("red", p.message)));
    return 1;
  }
  const setups = new Setups(options["--config"], overrides);

  const files = courseFilesOf(resolveFiles(paths));
  if (files.length === 0) {
    console.error(
      styleText("yellow", "No PrairieLearn course JSON files found in:")
    );
    for (const p of paths) {
      console.error(styleText("yellow", `  ${p}`));
    }
    return 1;
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  let filesWithErrors = 0;
  const checkedQuestions = new Set<string>();
  const listing: string[] = [];
  const output: string[] = [];
  const cwd = process.cwd();
  const displayPathOf = (file: string) => path.relative(cwd, file) || file;

  const report = (errors: CheckError[], source: () => string) => {
    const fileErrors = errors.filter((e) => e.severity === "error").length;
    if (errors.length > 0) {
      filesWithErrors++;
      totalErrors += fileErrors;
      totalWarnings += errors.length - fileErrors;
      if (format === "github") {
        output.push(...errors.map(formatGithubAnnotation));
      } else {
        const text = source();
        output.push(...errors.map((e) => formatError(e, text) + "\n"));
      }
    }
    return fileErrors;
  };

  for (const [file, courseRoot] of files) {
    const displayPath = displayPathOf(file);
    const { errors, questions } =
      courseRoot === null
        ? notInCourse(displayPath)
        : await checkFile(file, courseRoot, displayPath, setups.get(courseRoot));
    const fileErrors = report(errors, () => fs.readFileSync(file, "utf-8"));

    listing.push(
      errors.length > 0
        ? styleText(fileErrors > 0 ? "red" : "yellow", displayPath)
        : styleText("dim", displayPath)
    );
    for (const q of questions) {
      checkedQuestions.add(q.infoJson);
      const questionPath = "  " + (path.relative(cwd, q.infoJson) || q.infoJson);
      listing.push(styleText(q.hasError ? "red" : "dim", questionPath));
    }
  }

  for (const [configFile, problems] of setups.configProblems()) {
    const text = fs.readFileSync(configFile, "utf-8");
    report(
      problems.map((p) => toCheckError(p, text, displayPathOf(configFile))),
      () => text
    );
  }

  // Unavailable schemas are reported once, not on every file
  for (const problem of setups.schemaProblems()) {
    totalWarnings++;
    output.push(
      format === "github"
        ? `::warning title=prairielearn-navigator::${escapeGithubData(problem)}`
        : styleText("yellow", "warning") + `: ${problem}\n`
    );
  }

  // Every file verified, each assessment followed by its questions' info.json
  if (format === "github") {
    console.log("::group::Checked files");
    listing.forEach((line) => console.log(line));
    console.log("::endgroup::");
  } else {
    listing.forEach((line) => console.log(line));
  }

  if (output.length > 0) {
    if (format === "pretty") {
      console.log();
    }
    for (const line of output) {
      console.log(line);
    }
  }

  console.log(
    formatSummary(
      totalErrors,
      filesWithErrors,
      files.length,
      checkedQuestions.size,
      totalWarnings
    )
  );
  // Only errors affect exit code, not warnings
  return totalErrors > 0 ? 1 : 0;
}
