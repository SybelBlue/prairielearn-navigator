import * as fs from "node:fs";
import * as path from "node:path";
import { isExcluded, loadConfig, NavigatorConfig } from "./config";
import { courseRelativePath, matchesGlob } from "./courseFiles";
import { findElements } from "./html";
import { parseJsonDoc } from "./json";
import { versionDate } from "./plVersion";
import { FileRef, findFileRefs, sourceOf } from "./references/extract";
import { RefSpec, refSpecs } from "./references/specs";

export type QuestionFileProvenance =
  "question-local" | "template-local" | "course-level";

export interface ResolvedQuestionFile {
  /** Course-relative path with forward slashes. */
  path: string;
  provenance: QuestionFileProvenance;
}

export interface QuestionFileResolution {
  files: ResolvedQuestionFile[];
  /** False when at least one dependency could not be resolved statically. */
  complete: boolean;
  diagnostics: string[];
}

export interface QuestionFileDescriptor {
  qid: string;
  /** Course-relative question directory with forward slashes. */
  directory: string;
}

export interface QuestionFileResolverOptions {
  courseRoot: string;
  questions: readonly QuestionFileDescriptor[];
}

export interface QuestionFileResolutionUpdate {
  affectedQids: string[];
  resolutions: Map<string, QuestionFileResolution>;
}

export interface QuestionFileResolver {
  resolveAll(): Promise<Map<string, QuestionFileResolution>>;
  update(
    changedPaths: readonly string[],
    questions?: readonly QuestionFileDescriptor[],
  ): Promise<QuestionFileResolutionUpdate>;
}

type DependencyTarget =
  { kind: "file"; path: string } | { kind: "directory"; path: string };

interface InternalResolution extends QuestionFileResolution {
  dependencies: DependencyTarget[];
  templates: string[];
}

const ignoredSegments = new Set([".git", "__pycache__", "node_modules"]);
const ignoredBasename =
  /^(?:\.DS_Store|\.#.*|.*~|.*\.swp|.*\.swx|.*\.tmp|.*\.py[co])$/;

class Resolver implements QuestionFileResolver {
  private readonly courseRoot: string;
  private questions = new Map<string, QuestionFileDescriptor>();
  private resolutions = new Map<string, InternalResolution>();
  private config: NavigatorConfig;
  private configDiagnostics: string[];

  constructor(options: QuestionFileResolverOptions) {
    this.courseRoot = path.resolve(options.courseRoot);
    this.setQuestions(options.questions);
    const loaded = loadConfig(this.courseRoot);
    this.config = loaded.config;
    this.configDiagnostics = loaded.problems.map((problem) =>
      problem.file
        ? `${this.relative(problem.file)}: ${problem.message}`
        : problem.message,
    );
  }

  async resolveAll(): Promise<Map<string, QuestionFileResolution>> {
    const qids = [...this.questions.keys()].sort();
    await this.resolveQids(qids);
    return this.publicResolutions(qids);
  }

  async update(
    changedPaths: readonly string[],
    questions?: readonly QuestionFileDescriptor[],
  ): Promise<QuestionFileResolutionUpdate> {
    const oldQuestions = new Map(this.questions);
    const oldDescendants = this.templateDescendants();
    const affected = new Set<string>();

    if (questions) {
      this.setQuestions(questions);
      for (const [qid, previous] of oldQuestions) {
        const current = this.questions.get(qid);
        if (!current || current.directory !== previous.directory) {
          affected.add(qid);
          for (const descendant of oldDescendants.get(qid) ?? []) {
            affected.add(descendant);
          }
        }
      }
      for (const qid of this.questions.keys()) {
        if (!oldQuestions.has(qid)) {
          affected.add(qid);
          for (const descendant of oldDescendants.get(qid) ?? []) {
            affected.add(descendant);
          }
        }
      }
    }

    const normalizedChanges = changedPaths.map((changed) => {
      const normalized = normalizeRelative(changed);
      if (!normalized) {
        throw new Error(`Invalid changed path: ${changed}`);
      }
      return normalized;
    });
    if (normalizedChanges.includes(".pl-navigator.jsonc")) {
      const loaded = loadConfig(this.courseRoot);
      this.config = loaded.config;
      this.configDiagnostics = loaded.problems.map((problem) =>
        problem.file
          ? `${this.relative(problem.file)}: ${problem.message}`
          : problem.message,
      );
      for (const qid of this.questions.keys()) {
        affected.add(qid);
      }
    } else {
      for (const changed of normalizedChanges) {
        for (const [qid, question] of this.questions) {
          if (insideRelative(question.directory, changed)) {
            affected.add(qid);
            for (const descendant of oldDescendants.get(qid) ?? []) {
              affected.add(descendant);
            }
          }
        }
        for (const [qid, resolution] of this.resolutions) {
          if (
            resolution.dependencies.some((target) =>
              target.kind === "directory"
                ? insideRelative(target.path, changed)
                : target.path === changed,
            )
          ) {
            affected.add(qid);
          }
        }
      }
    }

    for (const qid of [...this.resolutions.keys()]) {
      if (!this.questions.has(qid)) {
        this.resolutions.delete(qid);
      }
    }
    const currentQids = [...affected]
      .filter((qid) => this.questions.has(qid))
      .sort();
    await this.resolveQids(currentQids);
    return {
      affectedQids: currentQids,
      resolutions: this.publicResolutions(currentQids),
    };
  }

  private async resolveQids(qids: readonly string[]): Promise<void> {
    await Promise.all(
      qids.map(async (qid) => {
        try {
          this.resolutions.set(qid, await this.resolveQuestion(qid));
        } catch (error) {
          this.resolutions.set(qid, {
            files: [],
            complete: false,
            diagnostics: [`Resolver failure: ${this.errorMessage(error)}`],
            dependencies: [],
            templates: [],
          });
        }
      }),
    );
  }

  private async resolveQuestion(qid: string): Promise<InternalResolution> {
    const files = new Map<string, QuestionFileProvenance>();
    const diagnostics = [...this.configDiagnostics];
    const dependencies: DependencyTarget[] = [];
    const templates = new Set<string>();
    const visited = new Set<string>();

    const resolveLayer = async (
      layerQid: string,
      provenance: "question-local" | "template-local",
    ): Promise<void> => {
      if (visited.has(layerQid)) {
        diagnostics.push(
          `Template cycle: ${[...visited, layerQid].join(" -> ")}`,
        );
        return;
      }
      visited.add(layerQid);
      const question = this.questions.get(layerQid);
      if (!question) {
        diagnostics.push(`Missing template question: ${layerQid}`);
        return;
      }
      const directory = this.absolute(question.directory);
      dependencies.push({ kind: "directory", path: question.directory });
      await this.collectDirectory(directory, provenance, files, diagnostics);

      for (const basename of ["info.json", "question.html"]) {
        const sourcePath = path.join(directory, basename);
        const sourceRelative = this.relative(sourcePath);
        if (!fs.existsSync(sourcePath)) {
          continue;
        }
        dependencies.push({ kind: "file", path: sourceRelative });
        const text = await fs.promises.readFile(sourcePath, "utf-8");
        if (basename === "info.json") {
          const parsed = parseJsonDoc(text);
          if (parsed.errors.length > 0) {
            diagnostics.push(
              `${sourceRelative}: invalid JSON; dependency resolution is partial`,
            );
          }
        }
        const refs = findFileRefs(
          sourceOf(text),
          sourceRelative,
          versionDate(this.config.plVersion),
          { courseRoot: this.courseRoot, fileDir: directory },
          (spec) => spec.files === `questions/**/${basename}`,
        );
        this.dynamicHtmlDiagnostics(sourceRelative, text, diagnostics);
        for (const ref of refs) {
          if (ref.value.includes("{{")) {
            diagnostics.push(
              `${sourceRelative}: dynamic reference cannot be resolved (${ref.spec.id})`,
            );
            continue;
          }
          if (ref.spec.target === "question") {
            if (!ref.target) {
              diagnostics.push(
                `${sourceRelative}: ${ref.problem ?? `invalid template ${ref.value}`} (${ref.spec.id})`,
              );
              continue;
            }
            const targetRelative = this.relativeOrNull(ref.target);
            const template = targetRelative
              ? ([...this.questions.values()].find(
                  (question) => question.directory === targetRelative,
                )?.qid ?? ref.value)
              : ref.value;
            templates.add(template);
            if (visited.has(template)) {
              diagnostics.push(
                `Template cycle: ${[...visited, template].join(" -> ")}`,
              );
              continue;
            }
            await resolveLayer(template, "template-local");
            continue;
          }
          await this.resolveReference(
            ref,
            sourceRelative,
            files,
            diagnostics,
            dependencies,
          );
        }
      }
    };

    await resolveLayer(qid, "question-local");
    const sortedFiles = [...files]
      .map(([filePath, provenance]) => ({ path: filePath, provenance }))
      .sort(
        (a, b) =>
          a.path.localeCompare(b.path) ||
          a.provenance.localeCompare(b.provenance),
      );
    const sortedDiagnostics = [...new Set(diagnostics)].sort();
    return {
      files: sortedFiles,
      complete: sortedDiagnostics.length === 0,
      diagnostics: sortedDiagnostics,
      dependencies: uniqueTargets(dependencies),
      templates: [...templates].sort(),
    };
  }

  private async resolveReference(
    ref: FileRef,
    sourceRelative: string,
    files: Map<string, QuestionFileProvenance>,
    diagnostics: string[],
    dependencies: DependencyTarget[],
  ): Promise<void> {
    if (!ref.target) {
      diagnostics.push(
        `${sourceRelative}: ${ref.problem ?? `invalid reference ${ref.value}`} (${ref.spec.id})`,
      );
      return;
    }
    const targetRelative = this.relativeOrNull(ref.target);
    if (!targetRelative) {
      diagnostics.push(
        `${sourceRelative}: reference escapes the course (${ref.spec.id})`,
      );
      return;
    }
    if (this.ignored(targetRelative)) {
      return;
    }
    dependencies.push({
      kind: ref.spec.target === "fileOrDir" ? "directory" : "file",
      path: targetRelative,
    });
    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(ref.target);
    } catch {
      diagnostics.push(
        `${sourceRelative}: file not found: ${targetRelative} (${ref.spec.id})`,
      );
      return;
    }
    if (stat.isSymbolicLink()) {
      await this.collectSymlink(ref.target, "course-level", files, diagnostics);
      return;
    }
    if (stat.isDirectory()) {
      if (ref.spec.target !== "fileOrDir") {
        diagnostics.push(
          `${sourceRelative}: expected a file: ${targetRelative} (${ref.spec.id})`,
        );
        return;
      }
      await this.collectDirectory(
        ref.target,
        "course-level",
        files,
        diagnostics,
      );
      return;
    }
    if (!stat.isFile()) {
      diagnostics.push(
        `${sourceRelative}: unsupported file type: ${targetRelative} (${ref.spec.id})`,
      );
      return;
    }
    files.set(
      targetRelative,
      this.provenanceFor(targetRelative, files.get(targetRelative)),
    );
  }

  private async collectDirectory(
    directory: string,
    provenance: QuestionFileProvenance,
    files: Map<string, QuestionFileProvenance>,
    diagnostics: string[],
  ): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (error) {
      const relative = this.relativeOrNull(directory) ?? "outside course";
      diagnostics.push(
        `${relative}: could not read directory: ${this.errorMessage(error)}`,
      );
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = this.relativeOrNull(absolute);
      if (!relative || this.ignored(relative)) {
        continue;
      }
      if (entry.isDirectory()) {
        await this.collectDirectory(absolute, provenance, files, diagnostics);
      } else if (entry.isFile()) {
        files.set(
          relative,
          this.provenanceFor(relative, files.get(relative), provenance),
        );
      } else if (entry.isSymbolicLink()) {
        await this.collectSymlink(absolute, provenance, files, diagnostics);
      }
    }
  }

  private async collectSymlink(
    absolute: string,
    provenance: QuestionFileProvenance,
    files: Map<string, QuestionFileProvenance>,
    diagnostics: string[],
  ): Promise<void> {
    const relative = this.relative(absolute);
    let real: string;
    try {
      real = await fs.promises.realpath(absolute);
    } catch (error) {
      diagnostics.push(
        `${relative}: broken symbolic link: ${this.errorMessage(error)}`,
      );
      return;
    }
    if (!this.relativeOrNull(real)) {
      diagnostics.push(`${relative}: symbolic link escapes the course`);
      return;
    }
    const stat = await fs.promises.stat(real);
    if (stat.isDirectory()) {
      diagnostics.push(
        `${relative}: symbolic-link directories are not followed`,
      );
      return;
    }
    if (!stat.isFile()) {
      diagnostics.push(`${relative}: symbolic link has an unsupported target`);
      return;
    }
    files.set(
      relative,
      this.provenanceFor(relative, files.get(relative), provenance),
    );
  }

  private dynamicHtmlDiagnostics(
    sourceRelative: string,
    text: string,
    diagnostics: string[],
  ) {
    for (const spec of refSpecs as readonly RefSpec[]) {
      if (spec.source !== "html" || !matchesGlob(sourceRelative, spec.files)) {
        continue;
      }
      for (const element of findElements(text, spec.html.tag)) {
        const value = element.attributes.get(spec.html.attr)?.value;
        const directory = element.attributes.get("directory")?.value;
        const type = element.attributes.get("type")?.value;
        if (
          [value, directory, type].some((candidate) =>
            candidate?.includes("{{"),
          )
        ) {
          diagnostics.push(
            `${sourceRelative}: dynamic reference cannot be resolved (${spec.id})`,
          );
        }
      }
    }
  }

  private templateDescendants(): Map<string, Set<string>> {
    const direct = new Map<string, Set<string>>();
    for (const [qid, resolution] of this.resolutions) {
      for (const template of resolution.templates) {
        const children = direct.get(template) ?? new Set<string>();
        children.add(qid);
        direct.set(template, children);
      }
    }
    const result = new Map<string, Set<string>>();
    const roots = new Set([...this.questions.keys(), ...direct.keys()]);
    for (const qid of roots) {
      const descendants = new Set<string>();
      const pending = [...(direct.get(qid) ?? [])];
      while (pending.length > 0) {
        const child = pending.pop()!;
        if (descendants.has(child)) {
          continue;
        }
        descendants.add(child);
        pending.push(...(direct.get(child) ?? []));
      }
      result.set(qid, descendants);
    }
    return result;
  }

  private setQuestions(questions: readonly QuestionFileDescriptor[]) {
    const next = new Map<string, QuestionFileDescriptor>();
    for (const question of questions) {
      const directory = normalizeRelative(question.directory);
      if (!question.qid || !directory || !directory.startsWith("questions/")) {
        throw new Error(
          `Invalid question descriptor: ${question.qid || "<empty>"}`,
        );
      }
      if (next.has(question.qid)) {
        throw new Error(`Duplicate QID: ${question.qid}`);
      }
      next.set(question.qid, { qid: question.qid, directory });
    }
    this.questions = next;
  }

  private publicResolutions(
    qids: readonly string[],
  ): Map<string, QuestionFileResolution> {
    const result = new Map<string, QuestionFileResolution>();
    for (const qid of qids) {
      const resolution = this.resolutions.get(qid);
      if (!resolution) {
        continue;
      }
      result.set(qid, {
        files: resolution.files.map((file) => ({ ...file })),
        complete: resolution.complete,
        diagnostics: [...resolution.diagnostics],
      });
    }
    return result;
  }

  private ignored(relative: string): boolean {
    const segments = relative.split("/");
    return (
      segments.some((segment) => ignoredSegments.has(segment)) ||
      ignoredBasename.test(segments.at(-1) ?? "") ||
      isExcluded(this.config, this.absolute(relative))
    );
  }

  private provenanceFor(
    _relative: string,
    previous?: QuestionFileProvenance,
    fallback: QuestionFileProvenance = "course-level",
  ): QuestionFileProvenance {
    if (previous === "question-local" || fallback === "question-local") {
      return "question-local";
    }
    if (previous === "template-local" || fallback === "template-local") {
      return "template-local";
    }
    return fallback;
  }

  private absolute(relative: string): string {
    return path.join(this.courseRoot, ...relative.split("/"));
  }

  private relative(absolute: string): string {
    return courseRelativePath(this.courseRoot, absolute);
  }

  private relativeOrNull(absolute: string): string | null {
    const relative = this.relative(path.resolve(absolute));
    return normalizeRelative(relative);
  }

  private errorMessage(error: unknown): string {
    return message(error).split(this.courseRoot).join(".");
  }
}

export function createQuestionFileResolver(
  options: QuestionFileResolverOptions,
): QuestionFileResolver {
  return new Resolver(options);
}

function normalizeRelative(value: string): string | null {
  if (value.includes("\\")) {
    return null;
  }
  const normalized = path.posix.normalize(value);
  if (
    !normalized ||
    normalized !== value ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized;
}

function insideRelative(directory: string, candidate: string): boolean {
  return candidate === directory || candidate.startsWith(`${directory}/`);
}

function uniqueTargets(
  targets: readonly DependencyTarget[],
): DependencyTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.kind}:${target.path}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
