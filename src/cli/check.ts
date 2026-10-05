import * as fs from "node:fs";
import * as path from "node:path";
import { styleText } from "node:util";
import { checkAssessment } from "../core/checks";
import { findCourseRoot } from "../core/course";
import { Diagnostic, offsetToPosition } from "../core/diagnostic";

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

type Format = "pretty" | "github";

// ── Error collection ──

function checkFile(file: string, displayPath: string): CheckError[] {
  const source = fs.readFileSync(file, "utf-8");
  const courseId = findCourseRoot(file);
  if (courseId === null) {
    return [
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
    ];
  }
  return checkAssessment(source, courseId).map((d) => {
    const start = offsetToPosition(source, d.startOffset);
    const end = offsetToPosition(source, d.endOffset);
    return {
      file: displayPath,
      line: start.line,
      column: start.column,
      endLine: end.line,
      endColumn: end.column,
      message: d.message,
      severity: d.severity,
    };
  });
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
  totalWarnings = 0
): string {
  const totalStr = totalFiles === 1 ? "file" : "files";
  if (totalErrors === 0 && totalWarnings === 0) {
    return styleText(
      "green",
      `No errors found (${totalFiles} ${totalStr} checked)`
    );
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
  return (
    `${parts.join(", ")} in ${filesWithErrors} ${errFileStr}` +
    ` (${totalFiles} ${totalStr} checked)`
  );
}

// ── File resolution ──

const DEFAULT_EXCLUDE_SEGMENTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
];

const ASSESSMENT_FILE = "infoAssessment.json";

function isGlob(p: string): boolean {
  return /[*?[\]{}]/.test(p);
}

/**
 * Expands a glob to infoAssessment.json files: matched files are kept by
 * name, and matched directories are searched recursively.
 */
function expandGlob(pattern: string, cwd: string): string[] {
  const matches = fs.globSync(
    [pattern, `${pattern.replace(/\/+$/, "")}/**/${ASSESSMENT_FILE}`],
    { cwd }
  );
  return matches
    .filter((m) => path.basename(m) === ASSESSMENT_FILE)
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
      for (const match of fs.globSync(`**/${ASSESSMENT_FILE}`, {
        cwd: resolved,
      })) {
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

// ── Main ──

const USAGE = `Usage: prairielearn-navigator check [options] [paths...]

Check infoAssessment.json files for missing, incomplete, and duplicate questions.

Arguments:
  paths     Course directories to search, infoAssessment.json files, or glob
            patterns matching either (default: .). Quote globs so the shell
            does not expand them.

Options:
  --format <pretty|github>  Output format (default: pretty). "github" emits
                            GitHub Actions annotations.
  --help                    Show this help message

Exit status is 1 if any errors are found; warnings do not affect it.

Examples:
  prairielearn-navigator check
  prairielearn-navigator check path/to/course
  prairielearn-navigator check "courseInstances/Fa26/**"
  prairielearn-navigator check "**/assessments/hw*/infoAssessment.json"
  prairielearn-navigator check --format github`;

export async function run(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  let format: Format = "pretty";
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let value: string | undefined;
    if (arg === "--format") {
      value = args[++i];
    } else if (arg.startsWith("--format=")) {
      value = arg.slice("--format=".length);
    } else if (arg.startsWith("-")) {
      console.error(styleText("red", `Unknown option: ${arg}`));
      console.error(USAGE);
      return 1;
    } else {
      paths.push(arg);
      continue;
    }
    if (value !== "pretty" && value !== "github") {
      console.error(
        styleText("red", `Invalid --format: ${value ?? "(missing)"}`)
      );
      return 1;
    }
    format = value;
  }
  if (paths.length === 0) {
    paths.push(".");
  }

  const files = resolveFiles(paths);
  if (files.length === 0) {
    console.error(
      styleText("yellow", "No infoAssessment.json files found in:")
    );
    for (const p of paths) {
      console.error(styleText("yellow", `  ${p}`));
    }
    return 1;
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  let filesWithErrors = 0;
  const output: string[] = [];
  const cwd = process.cwd();

  for (const file of files) {
    const displayPath = path.relative(cwd, file) || file;
    const errors = checkFile(file, displayPath);
    const fileErrors = errors.filter((e) => e.severity === "error").length;

    if (errors.length > 0) {
      filesWithErrors++;
      totalErrors += fileErrors;
      totalWarnings += errors.length - fileErrors;
      if (format === "github") {
        output.push(...errors.map(formatGithubAnnotation));
      } else {
        const source = fs.readFileSync(file, "utf-8");
        output.push(...errors.map((e) => formatError(e, source) + "\n"));
      }
    }

    if (format === "pretty") {
      console.log(
        errors.length > 0
          ? styleText(fileErrors > 0 ? "red" : "yellow", displayPath)
          : styleText("dim", displayPath)
      );
    }
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
    formatSummary(totalErrors, filesWithErrors, files.length, totalWarnings)
  );
  // Only errors affect exit code, not warnings
  return totalErrors > 0 ? 1 : 0;
}
