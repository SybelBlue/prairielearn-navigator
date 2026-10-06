import * as fs from "node:fs";
import * as path from "node:path";
import Ajv, { ValidateFunction } from "ajv";
import { isCommitSha, IsoDate, PlVersion, today } from "./plVersion";

export type SchemaName =
  | "infoCourse"
  | "infoCourseInstance"
  | "infoAssessment"
  | "infoQuestion"
  | "infoElementCourse"
  | "infoElementExtension";

const repo = "PrairieLearn/PrairieLearn";
/** Where schemas live in the PL repo, newest layout first. */
const schemaDirs = [
  "apps/prairielearn/src/schemas/schemas", // since 2023-05-01
  "schemas/schemas",
];

/** A PL version pinned to something fetchable and cacheable. */
interface ResolvedVersion {
  /** Cache subdirectory name. */
  key: string;
  /** Git ref to fetch raw files from. */
  ref: string;
  /** Human-readable, used in diagnostic messages. */
  label: string;
}

export interface LoadedSchema {
  validate: ValidateFunction;
  label: string;
}

type Fetch = (url: string, init?: { headers?: Record<string, string> }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface SchemaStoreOptions {
  cacheDir: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: Fetch;
  /** Raises the GitHub API rate limit for date versions. */
  githubToken?: string;
}

/**
 * Fetches PrairieLearn's JSON schemas for a given PL version and caches them
 * on disk as `<cacheDir>/<sha | master-YYYY-MM-DD>/<name>.json`.
 *
 * Failures never throw: `get` resolves to undefined and the reason is
 * recorded once in `problems`, so callers can report it a single time.
 */
export class SchemaStore {
  readonly problems = new Set<string>();
  private readonly fetch: Fetch;
  private readonly loading = new Map<string, Promise<LoadedSchema | undefined>>();
  private readonly resolving = new Map<PlVersion, Promise<ResolvedVersion | undefined>>();

  constructor(private readonly options: SchemaStoreOptions) {
    this.fetch = options.fetch ?? (globalThis.fetch as Fetch);
  }

  get cacheDir(): string {
    return this.options.cacheDir;
  }

  get(name: SchemaName, version: PlVersion): Promise<LoadedSchema | undefined> {
    const key = `${version}\0${name}`;
    let pending = this.loading.get(key);
    if (!pending) {
      pending = this.load(name, version);
      this.loading.set(key, pending);
    }
    return pending;
  }

  private async load(
    name: SchemaName,
    version: PlVersion
  ): Promise<LoadedSchema | undefined> {
    const resolved = await this.resolve(version);
    if (!resolved) {
      return undefined;
    }
    const text = await this.schemaText(name, resolved);
    if (text === undefined) {
      return undefined;
    }
    try {
      // A fresh instance per schema: PL's schemas may share an $id across files
      // strict: false tolerates any non-standard keywords PL adds
      const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
      return { validate: ajv.compile(JSON.parse(text)), label: resolved.label };
    } catch (e) {
      this.problems.add(`could not compile ${name} schema for PL ${resolved.label}: ${e}`);
      return undefined;
    }
  }

  private resolve(version: PlVersion): Promise<ResolvedVersion | undefined> {
    let pending = this.resolving.get(version);
    if (!pending) {
      pending = this.resolveUncached(version);
      this.resolving.set(version, pending);
    }
    return pending;
  }

  private async resolveUncached(
    version: PlVersion
  ): Promise<ResolvedVersion | undefined> {
    if (isCommitSha(version)) {
      return { key: version, ref: version, label: version.slice(0, 7) };
    }
    if (version === "latest") {
      // Refreshed daily without the rate-limited GitHub API
      const date = today();
      return { key: `master-${date}`, ref: "master", label: `latest (${date})` };
    }
    const sha = this.readRefs()[version] ?? (await this.lookupSha(version));
    if (!sha) {
      return undefined;
    }
    return { key: sha, ref: sha, label: `${version} (${sha.slice(0, 7)})` };
  }

  /** Last commit on master at or before the end of `date` (UTC). */
  private async lookupSha(date: IsoDate): Promise<string | undefined> {
    const url =
      `https://api.github.com/repos/${repo}/commits` +
      `?sha=master&until=${date}T23:59:59Z&per_page=1`;
    const headers: Record<string, string> = { accept: "application/vnd.github+json" };
    if (this.options.githubToken) {
      headers.authorization = `Bearer ${this.options.githubToken}`;
    }
    try {
      const res = await this.fetch(url, { headers });
      if (!res.ok) {
        const hint = res.status === 403 || res.status === 429
          ? " (rate limited; set GITHUB_TOKEN or pin a commit sha)"
          : "";
        this.problems.add(`could not resolve PL version ${date}: GitHub API returned ${res.status}${hint}`);
        return undefined;
      }
      const commits = (await res.json()) as { sha?: string }[];
      const sha = commits[0]?.sha;
      if (!sha) {
        this.problems.add(`no PrairieLearn commit found on or before ${date}`);
        return undefined;
      }
      this.writeRefs({ ...this.readRefs(), [date]: sha });
      return sha;
    } catch (e) {
      this.problems.add(`could not resolve PL version ${date} (offline?): ${e}`);
      return undefined;
    }
  }

  private async schemaText(
    name: SchemaName,
    resolved: ResolvedVersion
  ): Promise<string | undefined> {
    const dir = path.join(this.options.cacheDir, resolved.key);
    const file = path.join(dir, `${name}.json`);
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, "utf-8");
    }

    let lastStatus: string = "";
    for (const schemaDir of schemaDirs) {
      const url = `https://raw.githubusercontent.com/${repo}/${resolved.ref}/${schemaDir}/${name}.json`;
      try {
        const res = await this.fetch(url);
        if (res.ok) {
          const text = await res.text();
          this.writeCache(dir, file, text, resolved);
          return text;
        }
        lastStatus = `HTTP ${res.status}`;
        if (res.status !== 404) {
          break;
        }
      } catch (e) {
        this.problems.add(
          `schema ${name} for PL ${resolved.label} is not cached and could not be downloaded (offline?): ${e}`
        );
        return undefined;
      }
    }
    this.problems.add(`schema ${name} not found for PL ${resolved.label} (${lastStatus})`);
    return undefined;
  }

  private writeCache(dir: string, file: string, text: string, resolved: ResolvedVersion) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, text);
      if (resolved.ref === "master") {
        this.pruneStaleLatest(resolved.key);
      }
    } catch (e) {
      this.problems.add(`could not write schema cache ${dir}: ${e}`);
    }
  }

  private pruneStaleLatest(currentKey: string) {
    for (const entry of fs.readdirSync(this.options.cacheDir)) {
      if (entry.startsWith("master-") && entry !== currentKey) {
        fs.rmSync(path.join(this.options.cacheDir, entry), { recursive: true, force: true });
      }
    }
  }

  private get refsFile(): string {
    return path.join(this.options.cacheDir, "refs.json");
  }

  private readRefs(): Record<IsoDate, string> {
    try {
      return JSON.parse(fs.readFileSync(this.refsFile, "utf-8"));
    } catch {
      return {};
    }
  }

  private writeRefs(refs: Record<IsoDate, string>) {
    try {
      fs.mkdirSync(this.options.cacheDir, { recursive: true });
      fs.writeFileSync(this.refsFile, JSON.stringify(refs, undefined, 2) + "\n");
    } catch (e) {
      this.problems.add(`could not write ${this.refsFile}: ${e}`);
    }
  }
}
