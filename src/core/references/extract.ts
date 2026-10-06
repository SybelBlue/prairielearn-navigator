import * as fs from "node:fs";
import * as path from "node:path";
import { Node } from "jsonc-parser";
import { matchesGlob } from "../courseFiles";
import { findElements, HtmlElement } from "../html";
import { JsonDoc, parseJsonDoc } from "../json";
import { IsoDate, matchesRange } from "../plVersion";
import { baseDir, BaseName, inside, RefContext } from "./bases";
import { PathSegment, RefSpec, refSpecs } from "./specs";

export interface FileRef {
  spec: RefSpec;
  value: string;
  /** Offsets of the value, excluding quotes. */
  startOffset: number;
  endOffset: number;
  /**
   * Canonical absolute path the value names: the file, or for a question
   * its directory. Null when the reference is invalid (see `problem`).
   */
  target: string | null;
  /** Why the reference is invalid regardless of the file system. */
  problem?: string;
}

/** The file references are read from; `doc` is only read for JSON files. */
interface SourceFile {
  text: string;
  readonly doc: JsonDoc;
}

/** A SourceFile that parses its JSON on first use. */
export function sourceOf(text: string): SourceFile {
  let doc: JsonDoc | undefined;
  return {
    text,
    get doc() {
      return (doc ??= parseJsonDoc(text));
    },
  };
}

/** Whether any reference spec reads this course-relative path. */
export function holdsReferences(relPath: string): boolean {
  return refSpecs.some((s) => matchesGlob(relPath, s.files));
}

/** All file references in a course file, in document order. */
export function findFileRefs(
  source: SourceFile,
  relPath: string,
  plDate: IsoDate,
  ctx: RefContext,
  filter: (spec: RefSpec) => boolean = () => true
): FileRef[] {
  const refs: FileRef[] = [];
  for (const spec of refSpecs as readonly RefSpec[]) {
    if (!filter(spec) || !matchesGlob(relPath, spec.files) || !matchesRange(spec.range, plDate)) {
      continue;
    }
    if (spec.source === "json") {
      const tree = source.doc.tree;
      if (tree) {
        jsonRefs(spec, spec.json.json, spec.json.base, tree, ctx, refs);
      }
    } else {
      for (const element of findElements(source.text, spec.html.tag)) {
        const ref = htmlRef(spec, element, ctx);
        if (ref) {
          refs.push(ref);
        }
      }
    }
  }
  return refs.sort((a, b) => a.startOffset - b.startOffset);
}

/** The file reference whose value contains `offset`, if any. */
export function fileRefAt(refs: FileRef[], offset: number): FileRef | undefined {
  // Include the quotes, so a click just inside or outside them still counts
  return refs.find((r) => r.startOffset - 1 <= offset && offset <= r.endOffset + 1);
}

/** The file to open for a reference: a question opens its html, else its info.json. */
export function openTarget(ref: FileRef): string | null {
  if (ref.target === null || ref.spec.target !== "question") {
    return ref.target;
  }
  const html = path.join(ref.target, "question.html");
  return fs.existsSync(html) ? html : path.join(ref.target, "info.json");
}

// ── JSON ──

function segmentMatches(segment: PathSegment, key: string | number): boolean {
  if (segment === "*") {
    return true;
  }
  if (segment instanceof RegExp) {
    return typeof key === "string" && segment.test(key);
  }
  return segment === String(key);
}

function jsonRefs(
  spec: RefSpec,
  pattern: readonly PathSegment[],
  base: BaseName,
  node: Node,
  ctx: RefContext,
  out: FileRef[],
  depth = 0
) {
  if (depth === pattern.length) {
    if (node.type === "string") {
      const value = node.value as string;
      out.push({
        spec,
        value,
        startOffset: node.offset + 1,
        endOffset: node.offset + node.length - 1,
        ...resolve(spec, value, baseDir(base, ctx)),
      });
    }
    return;
  }
  const segment = pattern[depth];
  if (node.type === "object") {
    for (const prop of node.children ?? []) {
      const [key, value] = prop.children ?? [];
      if (key && value && segmentMatches(segment, key.value)) {
        jsonRefs(spec, pattern, base, value, ctx, out, depth + 1);
      }
    }
  } else if (node.type === "array") {
    (node.children ?? []).forEach((child, i) => {
      if (segmentMatches(segment, i)) {
        jsonRefs(spec, pattern, base, child, ctx, out, depth + 1);
      }
    });
  }
}

// ── HTML ──

/** Mustache is rendered before elements are, so these values are unknowable. */
const isTemplated = (value: string) => value.includes("{{");

function htmlRef(
  spec: RefSpec & { source: "html" },
  element: HtmlElement,
  ctx: RefContext
): FileRef | undefined {
  const { attr, directory, base, staticOnly } = spec.html;
  const value = element.attributes.get(attr);
  const type = element.attributes.get("type")?.value ?? "static";
  const dirAttr = element.attributes.get("directory");
  const dirName = dirAttr?.value ?? directory?.default ?? "";
  if (
    !value ||
    [value.value, type, dirName].some(isTemplated) ||
    (staticOnly && type.trim().toLowerCase() !== "static")
  ) {
    return undefined;
  }
  const ref = { spec, value: value.value, startOffset: value.startOffset, endOffset: value.endOffset };

  let dir: string | undefined;
  if (!directory) {
    dir = baseDir(base ?? "fileDir", ctx);
  } else if (Object.hasOwn(directory.named, dirName)) {
    dir = baseDir(directory.named[dirName], ctx);
  } else if (directory.relative) {
    dir = inside(ctx.fileDir, dirName, true) ?? undefined;
  }
  if (!dir) {
    const named = Object.keys(directory?.named ?? {}).map((d) => `"${d}"`);
    const allowed = named.length > 2 ? `one of ${named.join(", ")}` : named.join(" or ");
    return {
      ...ref,
      value: dirName,
      startOffset: dirAttr?.startOffset ?? ref.startOffset,
      endOffset: dirAttr?.endOffset ?? ref.endOffset,
      target: null,
      problem: directory?.relative
        ? `${spec.html.tag} directory "${dirName}" must be inside the question directory`
        : `invalid ${spec.html.tag} directory "${dirName}": must be ${allowed}`,
    };
  }
  return { ...ref, ...resolve(spec, value.value, dir, dirName) };
}

// ── Resolution ──

function resolve(
  spec: RefSpec,
  value: string,
  dir: string,
  dirLabel = spec.source === "json" ? spec.json.base : ""
): { target: string | null; problem?: string } {
  const target = inside(dir, value);
  if (target) {
    return { target };
  }
  const where =
    spec.target === "question" ? "questions/"
    : dirLabel === "fileDir" || dirLabel === "." || dirLabel === "" ? "its directory"
    : `${dirLabel}/`;
  return { target: null, problem: `"${value}" must be a path inside ${where}` };
}
