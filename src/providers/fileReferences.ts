import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { courseRelativePath } from "../core/courseFiles";
import { versionDate } from "../core/plVersion";
import { Use } from "../core/referenceIndex";
import { FileRef, fileRefAt, findFileRefs, openTarget, sourceOf } from "../core/references/extract";
import { refSpecs } from "../core/references/specs";
import { CourseCache, ReferenceIndexCache, useLocation } from "../filewatchers";
import { ConfigProvider } from "./config";

/** Documents that can contain file references (see core/references/specs.ts). */
export const fileReferenceSelector: vscode.DocumentFilter[] = [
  ...new Set(refSpecs.map((s) => s.files)),
].map((glob) => ({ scheme: "file", pattern: `**/${glob}` }));

/** Every file: any of them can be the target of a reference. */
export const anyFileSelector: vscode.DocumentFilter = { scheme: "file" };

/**
 * Jump-to-file and uses for every reference in core/references/specs.ts:
 * go-to-definition and Ctrl/Cmd-click links from a reference to its file,
 * and Find All References / a "uses" CodeLens from a file to its references.
 */
export class FileReferenceProvider
  implements
    vscode.DefinitionProvider,
    vscode.DocumentLinkProvider,
    vscode.ReferenceProvider,
    vscode.CodeLensProvider
{
  private cache = new WeakMap<vscode.TextDocument, { version: number; refs: FileRef[] }>();
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor(
    private courseCache: CourseCache,
    private configs: ConfigProvider,
    private references: ReferenceIndexCache
  ) {
    references.onChanged(() => this.onDidChangeCodeLensesEmitter.fire());
    // Courses or settings changing can change what a document refers to
    const reset = () => {
      this.cache = new WeakMap();
      this.onDidChangeCodeLensesEmitter.fire();
    };
    courseCache.onUpdated(reset);
    configs.onChanged(reset);
  }

  /** References in `document`, extracted once per document version. */
  private refsIn(document: vscode.TextDocument): FileRef[] {
    const cached = this.cache.get(document);
    if (cached?.version === document.version) {
      return cached.refs;
    }
    const courseRoot = this.courseCache.getCourseIdFor(document.uri);
    if (!courseRoot) {
      return []; // not cached: the course may just not be discovered yet
    }
    const { plVersion } = this.configs.configFor(courseRoot);
    const refs = findFileRefs(
      sourceOf(document.getText()),
      courseRelativePath(courseRoot, document.uri.fsPath),
      versionDate(plVersion),
      { courseRoot, fileDir: path.dirname(document.uri.fsPath) }
    );
    this.cache.set(document, { version: document.version, refs });
    return refs;
  }

  private refAt(document: vscode.TextDocument, position: vscode.Position) {
    return fileRefAt(this.refsIn(document), document.offsetAt(position));
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Definition | undefined {
    const ref = this.refAt(document, position);
    const target = ref && openTarget(ref);
    return target && fs.existsSync(target)
      ? new vscode.Location(vscode.Uri.file(target), new vscode.Position(0, 0))
      : undefined;
  }

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    // Missing targets are left to the diagnostics
    return this.refsIn(document).flatMap((ref) => {
      const target = openTarget(ref);
      if (!target || !fs.existsSync(target)) {
        return [];
      }
      const link = new vscode.DocumentLink(
        new vscode.Range(
          document.positionAt(ref.startOffset),
          document.positionAt(ref.endOffset)
        ),
        vscode.Uri.file(target)
      );
      link.tooltip = `Open ${vscode.workspace.asRelativePath(target)}`;
      return [link];
    });
  }

  /** On a reference: every use of its target. Elsewhere: every use of this file. */
  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[]> {
    const ref = this.refAt(document, position);
    const target = ref ? ref.target : document.uri.fsPath;
    const index = target && (await this.references.whenIndexed(document.uri));
    return index ? index.usesOf(target).map(useLocation) : [];
  }

  /**
   * "N uses" above any referenced file. Questions are left to the question
   * header lens, which already lists the assessments using them.
   */
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const index = await this.references.whenIndexed(document.uri);
    const uses = (index?.usesOf(document.uri.fsPath) ?? [])
      .filter((use) => use.ref.spec.target !== "question");
    if (uses.length === 0) {
      return [];
    }
    return [
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: usesTitle(uses),
        command: "prairielearn-navigator.showOccurrences",
        arguments: [uses.map(useLocation)],
      }),
    ];
  }
}

function usesTitle(uses: Use[]): string {
  const files = new Set(uses.map((u) => u.file)).size;
  return `${uses.length} ${uses.length === 1 ? "use" : "uses"}` +
    (files > 1 ? ` in ${files} files` : "");
}

/**
 * Explorer / palette command: show every reference to a file, binary or
 * not. Returns the locations shown.
 */
export function findUsesCommand(references: ReferenceIndexCache) {
  return async (uri?: vscode.Uri): Promise<vscode.Location[]> => {
    uri ??= vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      return [];
    }
    const index = await references.whenIndexed(uri);
    const locations = (index?.usesOf(uri.fsPath) ?? []).map(useLocation);
    if (locations.length === 0) {
      vscode.window.showInformationMessage(
        `No PrairieLearn references to ${path.basename(uri.fsPath)}`
      );
    } else {
      await vscode.commands.executeCommand("prairielearn-navigator.showOccurrences", locations);
    }
    return locations;
  };
}
