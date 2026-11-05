import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { courseFiles, courseRelativePath } from "../core/courseFiles";
import { offsetToPosition } from "../core/diagnostic";
import { parseJsonDoc } from "../core/json";
import {
  AssessmentSetInfo,
  assessmentSetAt,
  courseAssessmentSets,
  implicitAssessmentSet,
  plDefaultAssessmentSet,
} from "../core/assessmentSets";
import { findCourseNameReferences, planCourseNameRename } from "../core/courseNameRenames";
import { courseNameAt } from "../core/courseNames";
import {
  CourseTag,
  courseTags,
  implicitTagColor,
  plBadgeColors,
  plDefaultTag,
  tagAt,
  TagInfo,
} from "../core/tags";
import { CourseCache, ReferenceIndexCache } from "../filewatchers";

/** A file's text, from its editor if open, else from disk. */
export function currentText(file: string): string | undefined {
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

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** `label` (by default the color's name) drawn as PrairieLearn draws a badge of `color`. */
function badge(color: string, label = color): string {
  const colors = plBadgeColors[color];
  if (!colors) {
    return `\`${label.replace(/`/g, "")}\``;
  }
  // VS Code's hover sanitizer keeps only color and background-color styles
  return `<span style="color:${colors.text};background-color:${colors.background};">&nbsp;${escapeHtml(label)}&nbsp;</span>`;
}

/** The range of a definition's name in infoCourse.json, whose text need not be open. */
function definitionLocation(
  infoCourse: string,
  infoText: string,
  definition: { nameStart: number; nameEnd: number }
): vscode.Location {
  const positionOf = (offset: number) => {
    const { line, column } = offsetToPosition(infoText, offset);
    return new vscode.Position(line - 1, column - 1);
  };
  return new vscode.Location(
    vscode.Uri.file(infoCourse),
    new vscode.Range(positionOf(definition.nameStart), positionOf(definition.nameEnd))
  );
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
    return definitionLocation(found.infoCourse, found.infoText, found.defined);
  }
}

/**
 * Hover as PrairieLearn draws the assessment's badge: its set's
 * abbreviation and the assessment's number, in the set's color.
 */
function assessmentSetHover(set: AssessmentSetInfo, number: string | undefined, note?: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportHtml = true;
  const label = `${set.abbreviation ?? set.name}${number ?? ""}`;
  md.appendMarkdown(`${badge(set.color ?? "", label)}&nbsp;**${escapeMarkdown(set.name)}**`);
  const details = [
    set.heading === undefined ? undefined : `Heading: ${escapeMarkdown(set.heading)}`,
    note === undefined ? undefined : `_${note}_`,
  ].filter((d) => d !== undefined);
  if (details.length > 0) {
    md.appendMarkdown(`\n\n---\n\n${details.join("\n\n")}`);
  }
  return md;
}

/**
 * Hover and go-to-definition for an assessment's `set` in its
 * infoAssessment.json: the badge PrairieLearn draws for the assessment, the
 * set's heading, and its entry in infoCourse.json.
 */
export class AssessmentSetProvider implements vscode.HoverProvider, vscode.DefinitionProvider {
  constructor(private courseCache: Pick<CourseCache, "getCourseIdFor">) {}

  /** The set at `position`, and its definition in infoCourse.json if any. */
  private lookup(document: vscode.TextDocument, position: vscode.Position) {
    const courseRoot = this.courseCache.getCourseIdFor(document.uri);
    if (!courseRoot) {
      return undefined;
    }
    const text = document.getText();
    const set = assessmentSetAt(text, parseJsonDoc(text), document.offsetAt(position));
    if (!set) {
      return undefined;
    }
    const infoCourse = path.join(courseRoot, courseFiles.course);
    const infoText = currentText(infoCourse);
    const defined = infoText === undefined
      ? undefined
      : courseAssessmentSets(parseJsonDoc(infoText)).find((s) => s.name === set.name);
    return { set, infoCourse, infoText, defined };
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const found = this.lookup(document, position);
    if (!found) {
      return undefined;
    }
    const { set, defined } = found;
    const range = new vscode.Range(document.positionAt(set.start), document.positionAt(set.end));
    if (defined) {
      return new vscode.Hover(assessmentSetHover(defined, set.number), range);
    }
    const plDefault = plDefaultAssessmentSet(set.name);
    if (plDefault) {
      return new vscode.Hover(assessmentSetHover(plDefault, set.number, "PrairieLearn default assessment set"), range);
    }
    const implicit = implicitAssessmentSet(set.name);
    return new vscode.Hover(
      assessmentSetHover(
        implicit,
        set.number,
        `Not defined in infoCourse.json. PrairieLearn creates it as ${implicit.color}.`
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
    return definitionLocation(found.infoCourse, found.infoText, found.defined);
  }
}

/**
 * For a tag or assessment set infoCourse.json defines, from its definition
 * or from a question or assessment using it: renames it across the course
 * (the definition, every use, and suppressions naming it), and Find All
 * References lists its definition and every use.
 */
export class CourseNameProvider implements vscode.RenameProvider, vscode.ReferenceProvider {
  constructor(
    private courseCache: Pick<CourseCache, "getCourseIdFor">,
    private references: Pick<ReferenceIndexCache, "whenIndexed">
  ) {}

  /**
   * The tag or set name at `position`, with the offsets of its string
   * including quotes, and whether infoCourse.json defines it.
   */
  private nameAtPosition(document: vscode.TextDocument, position: vscode.Position) {
    const courseRoot = this.courseCache.getCourseIdFor(document.uri);
    if (!courseRoot) {
      return undefined;
    }
    const text = document.getText();
    const found = courseNameAt(courseRelativePath(courseRoot, document.uri.fsPath), text, document.offsetAt(position));
    if (!found) {
      return undefined;
    }
    const infoText = found.definition ? text : currentText(path.join(courseRoot, courseFiles.course));
    const defined = found.definition ||
      (infoText !== undefined && found.kind.definitions(parseJsonDoc(infoText)).some((d) => d.name === found.name));
    return { courseRoot, ...found, defined };
  }

  /** The name at `position`. Throws when infoCourse.json doesn't define it. */
  private renameable(document: vscode.TextDocument, position: vscode.Position) {
    const found = this.nameAtPosition(document, position);
    if (found && !found.defined) {
      throw new Error(`Only ${found.kind.noun}s defined in ${courseFiles.course} can be renamed`);
    }
    return found;
  }

  /** Index of the course at `courseRoot`, and its unsaved files the index may not have caught up with. */
  private async indexed(document: vscode.TextDocument, courseRoot: string) {
    const index = await this.references.whenIndexed(document.uri);
    const dirty = vscode.workspace.textDocuments
      .filter((doc) => doc.isDirty && doc.uri.fsPath.startsWith(courseRoot + path.sep))
      .map((doc) => doc.uri.fsPath);
    return { index, dirty };
  }

  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position
  ): { range: vscode.Range; placeholder: string } | undefined {
    const found = this.renameable(document, position);
    return found && {
      // Inside the quotes
      range: new vscode.Range(document.positionAt(found.start + 1), document.positionAt(found.end - 1)),
      placeholder: found.name,
    };
  }

  async provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string
  ): Promise<vscode.WorkspaceEdit | undefined> {
    const found = this.renameable(document, position);
    if (!found) {
      return undefined;
    }
    const { index, dirty } = await this.indexed(document, found.courseRoot);
    if (!index) {
      throw new Error(`Could not index the course at ${found.courseRoot}`);
    }
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of planCourseNameRename(found.kind, index, found.name, newName, currentText, dirty)) {
      workspaceEdit.replace(
        vscode.Uri.file(edit.file),
        new vscode.Range(edit.start.line - 1, edit.start.column - 1, edit.end.line - 1, edit.end.column - 1),
        edit.replacement
      );
    }
    return workspaceEdit;
  }

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext
  ): Promise<vscode.Location[]> {
    const found = this.nameAtPosition(document, position);
    if (!found?.defined) {
      return [];
    }
    const { index, dirty } = await this.indexed(document, found.courseRoot);
    if (!index) {
      return [];
    }
    const { definitions, uses } = findCourseNameReferences(found.kind, index, found.name, currentText, dirty);
    return [...(context.includeDeclaration ? definitions : []), ...uses].map(
      (o) => new vscode.Location(
        vscode.Uri.file(o.file),
        new vscode.Range(o.start.line - 1, o.start.column - 1, o.end.line - 1, o.end.column - 1)
      )
    );
  }
}
