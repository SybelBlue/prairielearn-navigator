import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { applyEdits, modify } from "jsonc-parser";
import { configFileName } from "../core/config";
import { parseJsonc } from "../core/json";
import { isRuleId, RuleId } from "../core/rules/registry";
import { CourseCache } from "../filewatchers";
import { vscodeRuleSettings } from "./ruleSettings";

const diagnosticPrefix = "prairielearn-navigator/";

export interface IgnoreDiagnosticArgs {
  courseRoot: string;
  file: string;
  rule: RuleId;
  message: string;
  occurrence: number;
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
  const entry = {
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

      if (courseRoot) {
        const ignore = new vscode.CodeAction(
          "Ignore this violation in this file",
          vscode.CodeActionKind.QuickFix
        );
        ignore.diagnostics = [diagnostic];
        ignore.command = {
          command: "prairielearn-navigator.ignoreDiagnostic",
          title: ignore.title,
          arguments: [{
            courseRoot,
            file: document.uri.fsPath,
            rule,
            message: diagnostic.message,
            occurrence: diagnosticOccurrence(document, diagnostic, rule),
          } satisfies IgnoreDiagnosticArgs],
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
