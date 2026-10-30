import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as z from "zod";
import { Diagnostic } from "./diagnostic";
import { matchesGlob } from "./courseFiles";
import { parseJsonDoc, rangeOf } from "./json";
import { PlVersion, validatePlVersion } from "./plVersion";
import { isRuleId, RuleId } from "./rules/registry";

/** Looked up in the course root, next to infoCourse.json. */
export const configFileName = ".pl-navigator.jsonc";

export const ruleSetting = z.enum(["off", "info", "warning", "error"]);
type RuleSetting = z.infer<typeof ruleSetting>;
export const severitySetting = z.enum(["ignored", "info", "warning", "error"]);

const ignoredDiagnosticBase = {
  file: z.string().min(1),
  rule: z.string().refine(isRuleId, "unknown rule"),
};
const ignoredDiagnosticSetting = z.union([
  z.object({
    ...ignoredDiagnosticBase,
    identifier: z.string().min(1),
  }).strict(),
  z.object({
    ...ignoredDiagnosticBase,
    message: z.string().min(1),
    occurrence: z.number().int().positive(),
  }).strict(),
]);

/** Config keys that are shorthand for one rule's setting, with "ignored" for "off". */
const severityKeys = {
  unusedQuestions: "unused-question",
  unusedTags: "unused-tag",
  unusedAssessmentSets: "unused-assessment-set",
  missingQuestionInfo: "question-info-missing",
} as const satisfies Record<string, RuleId>;

/** A glob and the directory it is relative to. */
interface Exclude {
  base: string;
  glob: string;
}

/** One exact diagnostic occurrence suppressed for one file. */
interface IgnoredDiagnostic {
  /** Absolute path of the file containing the diagnostic. */
  file: string;
  rule: RuleId;
  /** Stable semantic identity, e.g. a question id, tag name, or set name. */
  identifier?: string;
  /** Exact message fallback for rules without a semantic identity. */
  message?: string;
  /** 1-based occurrence among diagnostics with this rule and message. */
  occurrence?: number;
}

export interface NavigatorConfig {
  plVersion: PlVersion;
  /** Absolute. */
  schemaCacheDir: string;
  rules: Partial<Record<RuleId, RuleSetting>>;
  ignoredDiagnostics: IgnoredDiagnostic[];
  /** Files never checked. Every source adds to this rather than replacing it. */
  excludes: Exclude[];
}

/** Whether `file` matches one of the config's `excludes`. */
export function isExcluded(config: NavigatorConfig, file: string): boolean {
  return config.excludes.some(({ base, glob }) => {
    const rel = path.relative(base, file);
    return !rel.startsWith("..") && !path.isAbsolute(rel) &&
      matchesGlob(rel.split(path.sep).join("/"), glob);
  });
}

/** Same keys as the config file; from CLI flags or VS Code settings. */
export type ConfigOverrides = Partial<Record<keyof typeof fields, unknown>>;

/** A config problem, located in `file` when it came from one. */
export type ConfigProblem = Diagnostic & { file?: string };

export interface LoadedConfig {
  config: NavigatorConfig;
  /** The config file that was read, if any. */
  file?: string;
  problems: ConfigProblem[];
}

function defaultSchemaCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "prairielearn-navigator", "schemas");
}

/**
 * Reads `<courseRoot>/.pl-navigator.jsonc` (or `configPath`) and applies
 * `overrides` on top. Invalid values are reported and replaced by defaults;
 * this never throws.
 */
export function loadConfig(
  courseRoot: string | null,
  options: {
    configPath?: string;
    /** What a relative configPath is relative to (default: cwd). */
    configPathBaseDir?: string;
    overrides?: ConfigOverrides;
    /** What relative paths in `overrides` are relative to (default: cwd). */
    overridesBaseDir?: string;
    defaults?: Partial<NavigatorConfig>;
  } = {}
): LoadedConfig {
  const config: NavigatorConfig = {
    plVersion: "latest",
    schemaCacheDir: defaultSchemaCacheDir(),
    rules: {},
    ignoredDiagnostics: [],
    excludes: [],
    ...options.defaults,
  };
  const problems: ConfigProblem[] = [];

  const file = options.configPath === undefined
    ? courseRoot
      ? path.join(courseRoot, configFileName)
      : undefined
    : options.configPath === ""
      ? ""
      : path.resolve(options.configPathBaseDir ?? process.cwd(), options.configPath);
  let found: string | undefined;
  if (file && fs.existsSync(file)) {
    found = path.resolve(file);
    const doc = parseJsonDoc(fs.readFileSync(found, "utf-8"));
    for (const e of doc.errors) {
      problems.push({
        file: found,
        startOffset: e.offset,
        endOffset: e.offset + e.length,
        message: `invalid JSON: ${e.message}`,
        severity: "error",
      });
    }
    apply(config, doc.value, path.dirname(found), (message, key, severity = "error") =>
      problems.push({
        file: found,
        // Unknown keys (warnings) point at the key itself
        ...rangeOf(doc, key, { key: severity === "warning" }),
        message,
        severity,
      })
    );
  } else if (options.configPath) {
    problems.push({
      startOffset: 0,
      endOffset: 0,
      message: `config file not found: ${options.configPath}`,
      severity: "error",
    });
  }

  if (options.overrides) {
    apply(config, options.overrides, options.overridesBaseDir ?? process.cwd(), (message, _key, severity = "error") =>
      problems.push({ startOffset: 0, endOffset: 0, message, severity })
    );
  }

  return { config, file: found, problems };
}

type Report = (message: string, path: (string | number)[], severity?: Diagnostic["severity"]) => void;

/** One config source being applied. */
interface FieldContext {
  config: NavigatorConfig;
  /** What relative paths in this source are relative to. */
  baseDir: string;
  report: Report;
}

type Field = (key: string, value: unknown, ctx: FieldContext) => void;

/**
 * A config key: `schema` checks its value, `message` is reported on the key
 * when it fails (a custom issue's own message wins), and `set` applies it.
 */
function field<S extends z.ZodType>(
  schema: S,
  message: string | undefined,
  set: (value: z.output<S>, ctx: FieldContext) => void
): Field {
  return (key, value, ctx) => {
    const result = schema.safeParse(value, message ? { error: () => message } : undefined);
    if (result.success) {
      set(result.data, ctx);
    } else {
      ctx.report(result.error.issues[0].message, [key]);
    }
  };
}

const severityFields = Object.fromEntries(
  Object.entries(severityKeys).map(([key, rule]) => [
    key,
    field(
      severitySetting,
      `${key} must be "ignored", "info", "warning", or "error"`,
      (setting, { config }) => {
        config.rules = { ...config.rules, [rule]: setting === "ignored" ? "off" : setting };
      }
    ),
  ])
) as Record<keyof typeof severityKeys, Field>;

const fields = {
  plVersion: field(
    z.unknown().transform((value, ctx) => {
      const error = validatePlVersion(value);
      if (error) {
        ctx.addIssue({ code: "custom", message: error });
        return z.NEVER;
      }
      return value as PlVersion;
    }),
    undefined,
    (plVersion, { config }) => {
      config.plVersion = plVersion;
    }
  ),
  schemaCacheDir: field(
    z.string().min(1),
    "schemaCacheDir must be a non-empty string",
    (dir, { config, baseDir }) => {
      config.schemaCacheDir = path.resolve(baseDir, expandHome(dir));
    }
  ),
  excludes: field(
    z.array(z.string().min(1)),
    "excludes must be an array of glob patterns",
    (globs, { config, baseDir }) => {
      config.excludes = [
        ...config.excludes,
        ...globs.map((glob) => ({ base: baseDir, glob: glob.replace(/^\.\//, "") })),
      ];
    }
  ),
  ignoredDiagnostics: field(
    z.array(ignoredDiagnosticSetting),
    "ignoredDiagnostics must be an array of diagnostic suppressions",
    (diagnostics, { config, baseDir }) => {
      config.ignoredDiagnostics = [
        ...config.ignoredDiagnostics,
        ...diagnostics.map((diagnostic) => ({
          ...diagnostic,
          file: path.resolve(baseDir, diagnostic.file),
          rule: diagnostic.rule as RuleId,
        })),
      ];
    }
  ),
  rules: field(
    z.record(z.string(), z.unknown()),
    "rules must be an object of rule id to \"off\" | \"info\" | \"warning\" | \"error\"",
    (rules, { config, report }) => {
      // Each rule applies or is reported on its own
      for (const [id, setting] of Object.entries(rules)) {
        const parsed = ruleSetting.safeParse(setting);
        if (!isRuleId(id)) {
          report(`unknown rule "${id}"`, ["rules", id], "warning");
        } else if (!parsed.success) {
          report(`rule "${id}" must be "off", "info", "warning", or "error"`, ["rules", id]);
        } else {
          config.rules = { ...config.rules, [id]: parsed.data };
        }
      }
    }
  ),
  ...severityFields,
} satisfies Record<string, Field>;

/** Every key a config source may set, besides `$schema`. */
export const configKeys: readonly string[] = Object.keys(fields);

function apply(config: NavigatorConfig, raw: unknown, baseDir: string, report: Report) {
  if (raw === undefined) {
    return;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    report("config must be an object", []);
    return;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || key === "$schema") {
      continue;
    }
    if (Object.hasOwn(fields, key)) {
      fields[key as keyof typeof fields](key, value, { config, baseDir, report });
    } else {
      report(`unknown config key "${key}"`, [key], "warning");
    }
  }
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
}
