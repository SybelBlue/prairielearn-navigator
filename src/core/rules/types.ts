import { Diagnostic } from "../diagnostic";
import { JsonDoc } from "../json";
import { IsoDate, PlVersion, VersionRange } from "../plVersion";
import { SchemaStore } from "../schemas";

/** Everything a rule may inspect about the file being checked. */
interface RuleContext {
  courseRoot: string;
  filePath: string;
  /** Posix path relative to the course root, as matched by rule globs. */
  relPath: string;
  text: string;
  doc: JsonDoc;
  plVersion: PlVersion;
  /** The date `plVersion` stands for, used to select version-ranged rules. */
  plDate: IsoDate;
  schemas: SchemaStore;
}

export type RuleImpl = (ctx: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;

/**
 * One implementation of a rule for PL versions in `range` and files matching
 * `files` (a glob relative to the course root).
 */
export type RuleEntry = readonly [range: VersionRange, files: string, impl: RuleImpl];

/**
 * Rule id -> ordered entries. For each rule, the first entry whose range and
 * glob both match the file is the one that runs; put newer-version entries
 * above older ones.
 */
export type RuleTable = Record<string, readonly RuleEntry[]>;
