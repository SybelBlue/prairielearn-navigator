import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Diagnostic } from "./diagnostic";
import { parseJsonDoc, rangeOf } from "./json";
import { PlVersion, validatePlVersion } from "./plVersion";
import { isRuleId, RuleId } from "./rules/registry";

/** Looked up in the course root, next to infoCourse.json. */
export const configFileName = ".pl-navigator.jsonc";

type RuleSetting = "off" | "warning" | "error";
const ruleSettings: readonly string[] = ["off", "warning", "error"];

export interface NavigatorConfig {
  plVersion: PlVersion;
  /** Absolute. */
  schemaCacheDir: string;
  rules: Partial<Record<RuleId, RuleSetting>>;
}

/** Same keys as the config file; from CLI flags or VS Code settings. */
export type ConfigOverrides = Partial<Record<keyof NavigatorConfig, unknown>>;

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
  options: { configPath?: string; overrides?: ConfigOverrides; defaults?: Partial<NavigatorConfig> } = {}
): LoadedConfig {
  const config: NavigatorConfig = {
    plVersion: "latest",
    schemaCacheDir: defaultSchemaCacheDir(),
    rules: {},
    ...options.defaults,
  };
  const problems: ConfigProblem[] = [];

  const file =
    options.configPath ??
    (courseRoot ? path.join(courseRoot, configFileName) : undefined);
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
    apply(config, options.overrides, process.cwd(), (message, _key, severity = "error") =>
      problems.push({ startOffset: 0, endOffset: 0, message, severity })
    );
  }

  return { config, file: found, problems };
}

function apply(
  config: NavigatorConfig,
  raw: unknown,
  baseDir: string,
  report: (message: string, path: (string | number)[], severity?: Diagnostic["severity"]) => void
) {
  const unknown = (message: string, path: (string | number)[]) =>
    report(message, path, "warning");
  if (raw === undefined) {
    return;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    report("config must be an object", []);
    return;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) {
      continue;
    }
    switch (key) {
      case "$schema":
        break;
      case "plVersion": {
        const error = validatePlVersion(value);
        if (error) {
          report(error, [key]);
        } else {
          config.plVersion = value as PlVersion;
        }
        break;
      }
      case "schemaCacheDir":
        if (typeof value !== "string" || value === "") {
          report("schemaCacheDir must be a non-empty string", [key]);
        } else {
          config.schemaCacheDir = path.resolve(baseDir, expandHome(value));
        }
        break;
      case "rules":
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          report("rules must be an object of rule id to \"off\" | \"warning\" | \"error\"", [key]);
          break;
        }
        for (const [id, setting] of Object.entries(value)) {
          if (!isRuleId(id)) {
            unknown(`unknown rule "${id}"`, [key, id]);
          } else if (typeof setting !== "string" || !ruleSettings.includes(setting)) {
            report(`rule "${id}" must be "off", "warning", or "error"`, [key, id]);
          } else {
            config.rules = { ...config.rules, [id]: setting as RuleSetting };
          }
        }
        break;
      default:
        unknown(`unknown config key "${key}"`, [key]);
    }
  }
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
}
