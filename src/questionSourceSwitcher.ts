import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { commands } from "./commands";
import { QuestionPaths } from "./core/questionPaths";
import { QuestionCache } from "./filewatchers";

type QuestionFile = "questionHtml" | "infoJson" | "serverPy";

const contextKeys = {
  inQuestion: "prairielearn-navigator.inQuestion",
  currentQuestionFile: "prairielearn-navigator.currentQuestionFile",
  questionHtmlExists: "prairielearn-navigator.questionHtmlExists",
  infoJsonExists: "prairielearn-navigator.infoJsonExists",
  serverPyExists: "prairielearn-navigator.serverPyExists",
} as const;

const commandIds: Record<QuestionFile, string> = {
  questionHtml: "prairielearn-navigator.openQuestionHtml",
  infoJson: "prairielearn-navigator.openQuestionInfoJson",
  serverPy: "prairielearn-navigator.openQuestionServerPy",
};

function isInside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export class QuestionSourceSwitcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private updateContextsChain = Promise.resolve();

  constructor(private readonly questionCache: QuestionCache) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleContextUpdate()),
      this.questionCache.onUpdated(() => this.scheduleContextUpdate()),
    );

    for (const [target, commandId] of Object.entries(commandIds) as [
      QuestionFile,
      string,
    ][]) {
      this.disposables.push(
        vscode.commands.registerCommand(commandId, () => this.open(target)),
      );
    }

    this.scheduleContextUpdate();
  }

  private activeQuestion(): QuestionPaths | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri?.scheme !== "file") {
      return undefined;
    }

    let bestMatch: QuestionPaths | undefined;
    for (const id of this.questionCache.getQuestionIds()) {
      const paths = QuestionCache.questionFilePathsFromId(id);
      if (
        isFile(paths.infoJson) &&
        isInside(paths.dir, uri.fsPath) &&
        (!bestMatch || paths.dir.length > bestMatch.dir.length)
      ) {
        bestMatch = paths;
      }
    }
    return bestMatch;
  }

  private currentQuestionFile(paths: QuestionPaths): QuestionFile | "" {
    const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!activePath) {
      return "";
    }
    for (const target of Object.keys(commandIds) as QuestionFile[]) {
      if (path.relative(paths[target], activePath) === "") {
        return target;
      }
    }
    return "";
  }

  private scheduleContextUpdate(): void {
    this.updateContextsChain = this.updateContextsChain.then(
      () => this.updateContexts(),
      () => this.updateContexts(),
    );
  }

  private async updateContexts(): Promise<void> {
    const question = this.activeQuestion();
    await Promise.all([
      vscode.commands.executeCommand(
        "setContext",
        contextKeys.inQuestion,
        question !== undefined,
      ),
      vscode.commands.executeCommand(
        "setContext",
        contextKeys.currentQuestionFile,
        question ? this.currentQuestionFile(question) : "",
      ),
      vscode.commands.executeCommand(
        "setContext",
        contextKeys.questionHtmlExists,
        question ? isFile(question.questionHtml) : false,
      ),
      vscode.commands.executeCommand(
        "setContext",
        contextKeys.infoJsonExists,
        question ? isFile(question.infoJson) : false,
      ),
      vscode.commands.executeCommand(
        "setContext",
        contextKeys.serverPyExists,
        question ? isFile(question.serverPy) : false,
      ),
    ]);
  }

  private async open(target: QuestionFile): Promise<void> {
    const question = this.activeQuestion();
    if (!question) {
      return;
    }

    const targetPath = question[target];
    const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (activePath && path.relative(targetPath, activePath) === "") {
      return;
    }
    if (!isFile(targetPath)) {
      return;
    }

    await commands.openFile(targetPath);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
