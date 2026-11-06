import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  applyEdits,
  findNodeAtLocation,
  getLocation,
  modify,
  parseTree,
} from "jsonc-parser";
import { configFileName } from "../core/config";
import { courseFiles } from "../core/courseFiles";
import { removeEmptyParents } from "../core/emptyDirs";
import { parseJsonc, parseJsonDoc } from "../core/json";
import { isRuleId, RuleId } from "../core/rules/registry";
import { assessmentSetKind, NameKind, tagKind } from "../core/courseNames";
import { CourseCache } from "../filewatchers";
import { vscodeRuleSettings } from "./ruleSettings";

const diagnosticPrefix = "prairielearn-navigator/";

interface IgnoreDiagnosticBase {
  courseRoot: string;
  file: string;
  rule: RuleId;
}

export type IgnoreDiagnosticArgs = IgnoreDiagnosticBase & (
  | { identifier: string }
  | { message: string; occurrence: number }
);

export interface RemoveUnusedQuestionArgs {
  courseRoot: string;
  file: string;
}

export interface DefineCourseNameArgs {
  courseRoot: string;
  name: string;
}

/** The base rule id from a diagnostic code, including specialized schema codes. */
export function diagnosticRuleId(
  code: vscode.Diagnostic["code"]
): RuleId | undefined {
  const value = typeof code === "object" ? code.value : code;
  const text = value === undefined ? "" : String(value);
  if (!text.startsWith(diagnosticPrefix)) {
    return undefined;
  }
  const id = text.slice(diagnosticPrefix.length).split("/")[0];
  return isRuleId(id) ? id : undefined;
}

function relativeFile(courseRoot: string, file: string): string {
  return path.relative(courseRoot, file).split(path.sep).join("/");
}

function formattingOptions(text: string, eol: "\n" | "\r\n") {
  const indentation = text.match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
  return {
    insertSpaces: !indentation.includes("\t"),
    tabSize: indentation.includes("\t") ? 1 : indentation.length,
    eol,
  };
}

/** Adds one exact suppression to the course config. */
export async function ignoreDiagnostic(args: IgnoreDiagnosticArgs): Promise<boolean> {
  const configUri = vscode.Uri.file(path.join(args.courseRoot, configFileName));
  const entry = "identifier" in args ? {
    file: relativeFile(args.courseRoot, args.file),
    rule: args.rule,
    identifier: args.identifier,
  } : {
    file: relativeFile(args.courseRoot, args.file),
    rule: args.rule,
    message: args.message,
    occurrence: args.occurrence,
  };

  if (!fs.existsSync(configUri.fsPath)) {
    const contents = JSON.stringify({ ignoredDiagnostics: [entry] }, undefined, 2) + "\n";
    await vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(contents));
    return true;
  }

  const document = vscode.workspace.textDocuments.find(
    (candidate) => candidate.uri.fsPath === configUri.fsPath
  );
  const text = document?.getText() ?? await fs.promises.readFile(configUri.fsPath, "utf-8");
  const raw = parseJsonc(text);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    void vscode.window.showErrorMessage(
      `PrairieLearn Navigator: fix ${configFileName} before adding a diagnostic suppression.`
    );
    return false;
  }
  const existing = (raw as { ignoredDiagnostics?: unknown }).ignoredDiagnostics;
  if (existing !== undefined && !Array.isArray(existing)) {
    void vscode.window.showErrorMessage(
      `PrairieLearn Navigator: ${configFileName} ignoredDiagnostics must be an array.`
    );
    return false;
  }
  if (
    existing?.some(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        Object.entries(entry).every(
          ([key, value]) => (candidate as Record<string, unknown>)[key] === value
        )
    )
  ) {
    return true;
  }

  const edits = modify(
    text,
    ["ignoredDiagnostics", -1],
    entry,
    {
      formattingOptions: formattingOptions(
        text,
        document?.eol === vscode.EndOfLine.CRLF || (!document && text.includes("\r\n"))
          ? "\r\n"
          : "\n"
      ),
    }
  );
  if (!document) {
    await vscode.workspace.fs.writeFile(
      configUri,
      new TextEncoder().encode(applyEdits(text, edits))
    );
    return true;
  }

  const wasDirty = document.isDirty;
  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const edit of edits) {
    workspaceEdit.replace(
      configUri,
      new vscode.Range(
        document.positionAt(edit.offset),
        document.positionAt(edit.offset + edit.length)
      ),
      edit.content
    );
  }
  const applied = await vscode.workspace.applyEdit(workspaceEdit);
  if (applied && !wasDirty) {
    await document.save();
  } else if (applied) {
    await vscode.window.showTextDocument(document);
  }
  return applied;
}

/** Moves an unused question directory to Trash after rechecking and confirming. */
export async function removeUnusedQuestion(
  args: RemoveUnusedQuestionArgs
): Promise<boolean> {
  const questionsRoot = path.join(args.courseRoot, "questions") + path.sep;
  const questionDir = path.dirname(args.file);
  if (
    path.basename(args.file) !== "info.json" ||
    !questionDir.startsWith(questionsRoot)
  ) {
    return false;
  }
  const uri = vscode.Uri.file(args.file);
  const stillUnused = vscode.languages.getDiagnostics(uri).some(
    (diagnostic) =>
      diagnostic.source === "prairielearn-navigator" &&
      diagnosticRuleId(diagnostic.code) === "unused-question"
  );
  if (!stillUnused) {
    void vscode.window.showInformationMessage(
      "PrairieLearn Navigator: the question is no longer unused."
    );
    return false;
  }
  const localId = path.relative(path.join(args.courseRoot, "questions"), questionDir);
  const confirmed = await vscode.window.showWarningMessage(
    `Move unused question "${localId}" and all files in its directory to Trash?`,
    { modal: true },
    "Move to Trash"
  );
  if (confirmed !== "Move to Trash") {
    return false;
  }
  await vscode.workspace.fs.delete(vscode.Uri.file(questionDir), {
    recursive: true,
    useTrash: true,
  });
  removeEmptyParents(questionDir, path.join(args.courseRoot, "questions"));
  return true;
}

/**
 * The key of the entry `defineCourseName` selects for the user to change
 * first: the color PrairieLearn would give a tag, or the abbreviation of a
 * set, which PrairieLearn would make the whole name.
 */
const focusKey = { tags: "color", assessmentSets: "abbreviation" } as const;

/**
 * Adds a name to infoCourse.json as PrairieLearn would create it, then opens
 * the file with one field selected to change it (see focusKey). If the name
 * is already defined, selects that definition instead. The edit is left
 * unsaved.
 */
async function defineCourseName(kind: NameKind, args: DefineCourseNameArgs): Promise<boolean> {
  const uri = vscode.Uri.file(path.join(args.courseRoot, courseFiles.course));
  const document = await vscode.workspace.openTextDocument(uri);
  const existing = kind.definitions(parseJsonDoc(document.getText())).find((d) => d.name === args.name);
  if (existing) {
    const editor = await vscode.window.showTextDocument(document);
    const start = document.positionAt(existing.nameStart);
    editor.selection = new vscode.Selection(start, document.positionAt(existing.nameEnd));
    editor.revealRange(editor.selection);
    return true;
  }
  const text = document.getText();
  const root = parseJsonc(text);
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    void vscode.window.showErrorMessage(
      `PrairieLearn Navigator: fix ${courseFiles.course} before defining this ${kind.noun}.`
    );
    return false;
  }
  const edits = modify(
    text,
    [kind.collection, -1],
    kind.implicitDefinition(args.name),
    {
      formattingOptions: formattingOptions(
        text,
        document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n"
      ),
    }
  );
  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const edit of edits) {
    workspaceEdit.replace(
      uri,
      new vscode.Range(
        document.positionAt(edit.offset),
        document.positionAt(edit.offset + edit.length)
      ),
      edit.content
    );
  }
  if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
    return false;
  }
  const editor = await vscode.window.showTextDocument(document);
  const tree = parseTree(document.getText());
  const array = tree && findNodeAtLocation(tree, [kind.collection]);
  const added = array?.children?.at(-1);
  const focus = added && findNodeAtLocation(added, [focusKey[kind.collection]]);
  if (focus) {
    // Inside the quotes, so typing replaces the value
    editor.selection = new vscode.Selection(
      document.positionAt(focus.offset + 1),
      document.positionAt(focus.offset + focus.length - 1)
    );
    editor.revealRange(editor.selection);
  }
  return true;
}

/** Adds a tag to infoCourse.json's `tags`, in the color PrairieLearn would give it. */
export function defineTag(args: DefineCourseNameArgs): Promise<boolean> {
  return defineCourseName(tagKind, args);
}

/** Adds an assessment set to infoCourse.json's `assessmentSets`, as PrairieLearn would create it. */
export function defineAssessmentSet(args: DefineCourseNameArgs): Promise<boolean> {
  return defineCourseName(assessmentSetKind, args);
}

/** The kind of undefined name a diagnostic of `rule` is on, and its command to define one. */
const definableRules: Partial<Record<RuleId, { kind: NameKind; command: string }>> = {
  "undefined-tag": { kind: tagKind, command: "prairielearn-navigator.defineTag" },
  "undefined-assessment-set": { kind: assessmentSetKind, command: "prairielearn-navigator.defineAssessmentSet" },
};

/** The name an undefined-tag or undefined-assessment-set diagnostic is on. */
function undefinedName(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic
): string | undefined {
  const text = document.getText();
  const jsonPath = getLocation(text, document.offsetAt(diagnostic.range.start) + 1).path;
  const tree = parseTree(text);
  const node = tree && jsonPath.length > 0 ? findNodeAtLocation(tree, jsonPath) : undefined;
  return typeof node?.value === "string" ? node.value : undefined;
}

function diagnosticOccurrence(
  document: vscode.TextDocument,
  target: vscode.Diagnostic,
  rule: RuleId
): number {
  const matching = vscode.languages
    .getDiagnostics(document.uri)
    .filter(
      (diagnostic) =>
        diagnostic.source === "prairielearn-navigator" &&
        diagnosticRuleId(diagnostic.code) === rule &&
        diagnostic.message === target.message
    )
    .sort((a, b) => a.range.start.compareTo(b.range.start));
  const index = matching.findIndex((diagnostic) => diagnostic.range.isEqual(target.range));
  return index < 0 ? 1 : index + 1;
}

function semanticIdentifier(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  rule: RuleId,
  courseRoot: string
): string | undefined {
  if (rule === "unused-question" && courseRoot) {
    const questionDir = path.dirname(document.uri.fsPath);
    const questionsRoot = path.join(courseRoot, "questions") + path.sep;
    return questionDir.startsWith(questionsRoot)
      ? path.relative(path.join(courseRoot, "questions"), questionDir).split(path.sep).join("/")
      : undefined;
  }
  const collection =
    rule === "unused-tag" ? "tags"
    : rule === "unused-assessment-set" ? "assessmentSets"
    : undefined;
  if (!collection) {
    return undefined;
  }
  const jsonPath = getLocation(
    document.getText(),
    document.offsetAt(diagnostic.range.start)
  ).path;
  if (
    jsonPath[0] !== collection ||
    typeof jsonPath[1] !== "number" ||
    jsonPath[2] !== "name"
  ) {
    return undefined;
  }
  const tree = parseTree(document.getText());
  const node = tree && findNodeAtLocation(tree, [collection, jsonPath[1], "name"]);
  return typeof node?.value === "string" ? node.value : undefined;
}

function unusedItemRemoval(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  rule: RuleId,
  courseRoot: string
): vscode.CodeAction | undefined {
  if (rule === "unused-question" && courseRoot) {
    const action = new vscode.CodeAction(
      "Move unused question directory to Trash…",
      vscode.CodeActionKind.QuickFix
    );
    action.diagnostics = [diagnostic];
    action.command = {
      command: "prairielearn-navigator.removeUnusedQuestion",
      title: action.title,
      arguments: [{
        courseRoot,
        file: document.uri.fsPath,
      } satisfies RemoveUnusedQuestionArgs],
    };
    return action;
  }

  const collection =
    rule === "unused-tag" ? "tags"
    : rule === "unused-assessment-set" ? "assessmentSets"
    : undefined;
  if (!collection) {
    return undefined;
  }
  const jsonPath = getLocation(
    document.getText(),
    document.offsetAt(diagnostic.range.start)
  ).path;
  if (
    jsonPath[0] !== collection ||
    typeof jsonPath[1] !== "number" ||
    jsonPath[2] !== "name"
  ) {
    return undefined;
  }
  const title = rule === "unused-tag" ? "Remove unused tag" : "Remove unused assessment set";
  const tree = parseTree(document.getText());
  const array = tree && findNodeAtLocation(tree, [collection]);
  const items = array?.type === "array" ? array.children ?? [] : [];
  const index = jsonPath[1];
  const item = items[index];
  if (!item) {
    return undefined;
  }
  let startOffset = item.offset;
  let endOffset = item.offset + item.length;
  if (items.length > 1 && index === 0) {
    endOffset = items[1].offset;
  } else if (index > 0) {
    startOffset = items[index - 1].offset + items[index - 1].length;
  }
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  action.edit = new vscode.WorkspaceEdit();
  action.edit.delete(
    document.uri,
    new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset))
  );
  return action;
}

/** Linter-style suppression and severity actions for every rule diagnostic. */
export class DiagnosticQuickFixProvider implements vscode.CodeActionProvider {
  constructor(private courseCache: Pick<CourseCache, "getCourseIdFor">) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const courseRoot = this.courseCache.getCourseIdFor(document.uri);
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== "prairielearn-navigator") {
        continue;
      }
      const rule = diagnosticRuleId(diagnostic.code);
      if (!rule) {
        continue;
      }

      const removal = unusedItemRemoval(document, diagnostic, rule, courseRoot);
      if (removal) {
        actions.push(removal);
      }

      const definable = courseRoot ? definableRules[rule] : undefined;
      const name = definable && undefinedName(document, diagnostic);
      if (definable && name !== undefined) {
        const define = new vscode.CodeAction(
          `Define ${definable.kind.noun} "${name}" in ${courseFiles.course}`,
          vscode.CodeActionKind.QuickFix
        );
        define.diagnostics = [diagnostic];
        define.isPreferred = true;
        define.command = {
          command: definable.command,
          title: define.title,
          arguments: [{ courseRoot, name } satisfies DefineCourseNameArgs],
        };
        actions.push(define);
      }

      if (courseRoot) {
        const identifier = semanticIdentifier(document, diagnostic, rule, courseRoot);
        const ignore = new vscode.CodeAction(
          "Ignore this violation in this file",
          vscode.CodeActionKind.QuickFix
        );
        ignore.diagnostics = [diagnostic];
        ignore.command = {
          command: "prairielearn-navigator.ignoreDiagnostic",
          title: ignore.title,
          arguments: [(
            identifier !== undefined
              ? { courseRoot, file: document.uri.fsPath, rule, identifier }
              : {
                  courseRoot,
                  file: document.uri.fsPath,
                  rule,
                  message: diagnostic.message,
                  occurrence: diagnosticOccurrence(document, diagnostic, rule),
                }
          ) satisfies IgnoreDiagnosticArgs],
        };
        actions.push(ignore);
      }

      const configure = new vscode.CodeAction(
        `Configure severity for ${rule}…`,
        vscode.CodeActionKind.QuickFix
      );
      configure.diagnostics = [diagnostic];
      configure.command = {
        command: "workbench.action.openSettings",
        title: configure.title,
        arguments: [`@id:prairielearn-navigator.${vscodeRuleSettings[rule]}`],
      };
      actions.push(configure);
    }
    return actions;
  }
}
