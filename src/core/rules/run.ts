import { NavigatorConfig } from "../config";
import { courseRelativePath, matchesGlob } from "../courseFiles";
import { Diagnostic } from "../diagnostic";
import { parseJsonDoc } from "../json";
import { IsoDate, matchesRange, versionDate } from "../plVersion";
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
  options: { courseRoot: string; config: NavigatorConfig; schemas: SchemaStore }
): Promise<Diagnostic[]> {
  const { courseRoot, config, schemas } = options;
  const relPath = courseRelativePath(courseRoot, filePath);
  const plDate = versionDate(config.plVersion);
  const ctx = {
    courseRoot,
    filePath,
    relPath,
    text,
    doc: parseJsonDoc(text),
    plVersion: config.plVersion,
    plDate,
    schemas,
  };

  const results = await Promise.all(
    selectRules<RuleId>(relPath, plDate)
      .filter(([id]) => config.rules[id] !== "off")
      .map(async ([id, impl]) => {
        const setting = config.rules[id];
        return (await impl(ctx)).map(
          (d): Diagnostic => ({
            ...d,
            code: ruleDiagnosticCode(id),
            severity: setting === "warning" || setting === "error" ? setting : d.severity,
          })
        );
      })
  );
  return results.flat().sort((a, b) => a.startOffset - b.startOffset);
}
