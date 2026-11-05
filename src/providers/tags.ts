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
import { CourseCache } from "../filewatchers";

/** infoCourse.json's text, from its editor if open, else from disk. */
function courseInfoText(infoCourse: string): string | undefined {
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === infoCourse);
  if (open) {
    return open.getText();
  }
  try {
    return fs.readFileSync(infoCourse, "utf-8");
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
    const infoText = courseInfoText(infoCourse);
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
