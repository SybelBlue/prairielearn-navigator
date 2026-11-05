import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { courseFiles } from "../core/courseFiles";
import { offsetToPosition } from "../core/diagnostic";
import { parseJsonDoc } from "../core/json";
import {
  CourseTag,
  courseTags,
  implicitTagColor,
  plBadgeColors,
  plDefaultTag,
  tagAt,
  TagInfo,
} from "../core/tags";
import { planTagRename } from "../core/tagRenames";
import { CourseCache, ReferenceIndexCache } from "../filewatchers";

/** A file's text, from its editor if open, else from disk. */
function currentText(file: string): string | undefined {
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === file);
  if (open) {
    return open.getText();
  }
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>&]/g, (c) => `\\${c}`);
}

/** The color name drawn as PrairieLearn draws a badge of that color. */
function badge(color: string): string {
  const colors = plBadgeColors[color];
  if (!colors) {
    return `\`${color.replace(/`/g, "")}\``;
  }
  // VS Code's hover sanitizer keeps only color and background-color styles
  return `<span style="color:${colors.text};background-color:${colors.background};">&nbsp;${color}&nbsp;</span>`;
}

function tagHover(tag: TagInfo, note?: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportHtml = true;
  md.appendMarkdown(`${tag.color ? `${badge(tag.color)}&nbsp;` : ""}**${escapeMarkdown(tag.name)}**`);
  if (tag.description || note) {
    md.appendMarkdown("\n\n---\n\n");
  }
  if (tag.description) {
    md.appendMarkdown(tag.description);
  }
  if (note) {
    md.appendMarkdown(`${tag.description ? "\n\n" : ""}_${note}_`);
  }
  return md;
}

/**
 * Hover and go-to-definition for the tags in a question's info.json: the
 * tag's color and description, and its entry in infoCourse.json.
 */
export class TagProvider implements vscode.HoverProvider, vscode.DefinitionProvider {
  constructor(private courseCache: Pick<CourseCache, "getCourseIdFor">) {}

  /** The tag at `position`, and its definition in infoCourse.json if any. */
  private lookup(document: vscode.TextDocument, position: vscode.Position) {
    const courseRoot = this.courseCache.getCourseIdFor(document.uri);
    if (!courseRoot) {
      return undefined;
    }
    const text = document.getText();
    const tag = tagAt(text, parseJsonDoc(text), document.offsetAt(position));
    if (!tag) {
      return undefined;
    }
    const infoCourse = path.join(courseRoot, courseFiles.course);
    const infoText = currentText(infoCourse);
    const defined: CourseTag | undefined = infoText === undefined
      ? undefined
      : courseTags(parseJsonDoc(infoText)).find((t) => t.name === tag.name);
    return { tag, infoCourse, infoText, defined };
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const found = this.lookup(document, position);
    if (!found) {
      return undefined;
    }
    const { tag, defined } = found;
    const range = new vscode.Range(document.positionAt(tag.start), document.positionAt(tag.end));
    if (defined) {
      return new vscode.Hover(tagHover(defined), range);
    }
    const plDefault = plDefaultTag(tag.name);
    if (plDefault) {
      return new vscode.Hover(tagHover(plDefault, "PrairieLearn default tag"), range);
    }
    return new vscode.Hover(
      tagHover(
        { name: tag.name, color: implicitTagColor },
        `Not defined in infoCourse.json. PrairieLearn creates it as ${implicitTagColor}.`
      ),
      range
    );
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Location | undefined {
    const found = this.lookup(document, position);
    if (!found?.defined || found.infoText === undefined) {
      return undefined;
    }
    const { defined, infoCourse, infoText } = found;
    // Offsets into infoCourse.json's text, which need not be open
    const positionOf = (offset: number) => {
      const { line, column } = offsetToPosition(infoText, offset);
      return new vscode.Position(line - 1, column - 1);
    };
    return new vscode.Location(
      vscode.Uri.file(infoCourse),
      new vscode.Range(positionOf(defined.nameStart), positionOf(defined.nameEnd))
    );
  }
}

/**
 * Renames a tag infoCourse.json defines, from its definition or from a
 * question using it: the definition, every question's entry, and
 * suppressions naming it.
 */
export class TagRenameProvider implements vscode.RenameProvider {
  constructor(
    private courseCache: Pick<CourseCache, "getCourseIdFor">,
    private references: Pick<ReferenceIndexCache, "whenIndexed">
  ) {}

  /**
   * The tag at `position`, with the offsets of its string including quotes.
   * Throws when it is a tag infoCourse.json doesn't define.
   */
  private renameable(document: vscode.TextDocument, position: vscode.Position) {
    const courseRoot = this.courseCache.getCourseIdFor(document.uri);
    if (!courseRoot) {
      return undefined;
    }
    const text = document.getText();
    const offset = document.offsetAt(position);
    const infoCourse = path.join(courseRoot, courseFiles.course);
    if (document.uri.fsPath === infoCourse) {
      const tag = courseTags(parseJsonDoc(text)).find((t) => t.nameStart <= offset && offset <= t.nameEnd);
      return tag && { courseRoot, name: tag.name, start: tag.nameStart, end: tag.nameEnd };
    }
    const tag = tagAt(text, parseJsonDoc(text), offset);
    if (!tag) {
      return undefined;
    }
    const infoText = currentText(infoCourse);
    if (infoText === undefined || !courseTags(parseJsonDoc(infoText)).some((t) => t.name === tag.name)) {
      throw new Error(`Only tags defined in ${courseFiles.course} can be renamed`);
    }
    return { courseRoot, name: tag.name, start: tag.start, end: tag.end };
  }

  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position
  ): { range: vscode.Range; placeholder: string } | undefined {
    const tag = this.renameable(document, position);
    return tag && {
      // Inside the quotes
      range: new vscode.Range(document.positionAt(tag.start + 1), document.positionAt(tag.end - 1)),
      placeholder: tag.name,
    };
  }

  async provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string
  ): Promise<vscode.WorkspaceEdit | undefined> {
    const tag = this.renameable(document, position);
    if (!tag) {
      return undefined;
    }
    const index = await this.references.whenIndexed(document.uri);
    if (!index) {
      throw new Error(`Could not index the course at ${tag.courseRoot}`);
    }
    // Unsaved questions the index may not have caught up with yet
    const dirty = vscode.workspace.textDocuments
      .filter((doc) => doc.isDirty && doc.uri.fsPath.startsWith(tag.courseRoot + path.sep))
      .map((doc) => doc.uri.fsPath);
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of planTagRename(index, tag.name, newName, currentText, dirty)) {
      workspaceEdit.replace(
        vscode.Uri.file(edit.file),
        new vscode.Range(edit.start.line - 1, edit.start.column - 1, edit.end.line - 1, edit.end.column - 1),
        edit.replacement
      );
    }
    return workspaceEdit;
  }
}
