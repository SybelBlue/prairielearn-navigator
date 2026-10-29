import * as path from "node:path";
import { isExcluded, NavigatorConfig } from "../config";
import { courseRelativePath, matchesGlob } from "../courseFiles";
import { Diagnostic } from "../diagnostic";
import { JsonDoc, parseJsonDoc } from "../json";
import { IsoDate, matchesRange, versionDate } from "../plVersion";
import { questionDirsWithoutInfo } from "../questionDirs";
import { ReferenceIndex } from "../referenceIndex";
import { SchemaStore } from "../schemas";
import { ruleDiagnosticCode, RuleId, rules } from "./registry";
import { RuleEntry, RuleImpl, RuleTable } from "./types";

/** The implementation of each rule that applies to `relPath` at `plDate`. */
export function selectRules<Id extends string = RuleId>(
  relPath: string,
  plDate: IsoDate,
  table: RuleTable = rules
): [Id, RuleImpl][] {
  const selected: [Id, RuleImpl][] = [];
  for (const [id, entries] of Object.entries(table) as [Id, readonly RuleEntry[]][]) {
    const entry = entries.find(
      ([range, files]) => matchesGlob(relPath, files) && matchesRange(range, plDate)
    );
    if (entry) {
      selected.push([id, entry[2]]);
    }
  }
  return selected;
}

/** Globs, relative to a course root, of every file some rule applies to. */
export function checkableGlobs(): string[] {
  return [...new Set(Object.values(rules).flatMap((entries) => entries.map(([, files]) => files)))];
}

/** Whether any rule applies to this course-relative path, at any version. */
export function isCheckable(relPath: string): boolean {
  return Object.values(rules).some((entries: readonly RuleEntry[]) =>
    entries.some(([, files]) => matchesGlob(relPath, files))
  );
}

/** Runs every applicable, enabled rule on one file of a course. */
export async function runRules(
  filePath: string,
  text: string,
  options: {
    courseRoot: string;
    config: NavigatorConfig;
    schemas: SchemaStore;
    references?: ReferenceIndex;
  }
): Promise<Diagnostic[]> {
  const { courseRoot, config, schemas, references } = options;
  const relPath = courseRelativePath(courseRoot, filePath);
  const plDate = versionDate(config.plVersion);
  let doc: JsonDoc | undefined;
  const ctx = {
    courseRoot,
    filePath,
    relPath,
    text,
    // Parsed on first use: not every rule reads JSON
    get doc() {
      return (doc ??= parseJsonDoc(text));
    },
    plVersion: config.plVersion,
    plDate,
    schemas,
    references,
  };

  const results = await Promise.all(
    selectRules<RuleId>(relPath, plDate)
      .filter(([id]) => config.rules[id] !== "off")
      .map(async ([id, impl]) => {
        const setting = config.rules[id];
        let diagnostics: Diagnostic[];
        try {
          diagnostics = await impl(ctx);
        } catch (e) {
          // One broken rule must not stop the others
          diagnostics = [{ startOffset: 0, endOffset: 0, message: `internal error in rule: ${e}`, severity: "warning" }];
        }
        return diagnostics.map((d) => withRuleSetting(d, id, config));
      })
  );
  return results.flat().sort((a, b) => a.startOffset - b.startOffset);
}

/** Tags a rule's diagnostic with its code and the configured severity. */
function withRuleSetting(d: Diagnostic, id: RuleId, config: NavigatorConfig): Diagnostic {
  const setting = config.rules[id];
  return {
    ...d,
    code: ruleDiagnosticCode(id),
    severity: setting !== undefined && setting !== "off" ? setting : d.severity,
  };
}

/**
 * Runs the rules that look at a course as a whole rather than one file.
 * Returns diagnostics by the absolute path of the file each is shown on.
 */
export function runCourseRules(
  courseRoot: string,
  config: NavigatorConfig
): Map<string, Diagnostic[]> {
  const out = new Map<string, Diagnostic[]>();
  if (config.rules["question-info-missing"] === "off") {
    return out;
  }
  for (const { dir, anchor } of questionDirsWithoutInfo(courseRoot)) {
    if (isExcluded(config, anchor)) {
      continue;
    }
    const infoJson = path.join(dir, "info.json");
    const localId = courseRelativePath(path.join(courseRoot, "questions"), dir);
    const diagnostic: Diagnostic = {
      startOffset: 0,
      endOffset: 0,
      message:
        `directory "${localId}" in questions/ has files but no info.json: ` +
        `PrairieLearn will fail to load it from disk ` +
        `(Missing JSON file: ${courseRelativePath(courseRoot, infoJson)})`,
      severity: "error",
      related: [{ path: infoJson, message: "Expected location of info.json" }],
    };
    out.set(anchor, [withRuleSetting(diagnostic, "question-info-missing", config)]);
  }
  return out;
}
