import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { courseFiles, courseRelativePath, questionHtml } from "../core/courseFiles";
import { versionDate } from "../core/plVersion";
import { FileRef, fileRefAt, findFileRefs, sourceOf } from "../core/references";
import { CourseCache } from "../filewatchers";
import { ConfigProvider } from "./config";

/** Documents that can contain file references (see core/references.ts). */
export const fileReferenceSelector: vscode.DocumentFilter[] = [
  courseFiles.question,
  courseFiles.element,
  courseFiles.elementExtension,
  courseFiles.assessment,
  questionHtml,
].map((glob) => ({ pattern: `**/${glob}` }));

/**
 * Jump-to-file for every JSON field that names another course file:
 * go-to-definition, plus Ctrl/Cmd-click links on references that exist.
 */
export class FileReferenceProvider
  implements vscode.DefinitionProvider, vscode.DocumentLinkProvider
{
  constructor(
    private courseCache: CourseCache,
    private configs: ConfigProvider
  ) {}

  private context(document: vscode.TextDocument) {
    const courseRoot = this.courseCache.getCourseIdFor(document.uri);
    if (!courseRoot) {
      return undefined;
    }
    const { plVersion } = this.configs.configFor(courseRoot);
    return {
      source: sourceOf(document.getText()),
      relPath: courseRelativePath(courseRoot, document.uri.fsPath),
      plDate: versionDate(plVersion),
      refContext: { courseRoot, fileDir: path.dirname(document.uri.fsPath) },
    };
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Definition | undefined {
    const ctx = this.context(document);
    if (!ctx) {
      return undefined;
    }
    const ref = fileRefAt(
      ctx.source,
      ctx.relPath,
      ctx.plDate,
      ctx.refContext,
      document.offsetAt(position)
    );
    return ref && exists(ref)
      ? new vscode.Location(vscode.Uri.file(ref.target), new vscode.Position(0, 0))
      : undefined;
  }

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const ctx = this.context(document);
    if (!ctx) {
      return [];
    }
    // Missing targets are left to the diagnostics
    return findFileRefs(ctx.source, ctx.relPath, ctx.plDate, ctx.refContext)
      .filter(exists)
      .map((ref) => {
        const link = new vscode.DocumentLink(
          new vscode.Range(
            document.positionAt(ref.startOffset),
            document.positionAt(ref.endOffset)
          ),
          vscode.Uri.file(ref.target)
        );
        link.tooltip = `Open ${path.relative(ctx.refContext.courseRoot, ref.target)}`;
        return link;
      });
  }
}

function exists(ref: FileRef): ref is FileRef & { target: string } {
  return ref.target !== null && fs.existsSync(ref.target);
}
