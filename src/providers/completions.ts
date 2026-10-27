import * as vscode from "vscode";
import { QuestionCache } from "../filewatchers";
import { generateUuid, reportUuidGenerationError } from "./uuid";

/** Whether the cursor is between the quotes of an empty `uuid` value. */
export function isEmptyUuidValue(
  document: vscode.TextDocument,
  position: vscode.Position,
): boolean {
  const line = document.lineAt(position);
  const before = line.text.slice(0, position.character);
  const after = line.text.slice(position.character);
  return /"uuid"\s*:\s*"$/.test(before) && /^"/.test(after);
}

export class UuidCompletionItemProvider
  implements vscode.CompletionItemProvider
{
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const linePrefix = document
      .lineAt(position)
      .text.slice(0, position.character);
    const match = linePrefix.match(/"uuid"\s*:\s*"([^"]*)$/);
    if (!match || token.isCancellationRequested) {
      return;
    }

    try {
      const uuid = await generateUuid(document);
      if (token.isCancellationRequested) {
        return;
      }

      const start = position.translate(0, -match[1].length);
      const item = new vscode.CompletionItem(
        uuid,
        vscode.CompletionItemKind.Event,
      );
      item.detail = "Generate a new UUID";
      item.range = new vscode.Range(start, position);
      return [item];
    } catch (error) {
      reportUuidGenerationError(error);
      return;
    }
  }
}

export class AssessmentCompletionItemProvider
  implements vscode.CompletionItemProvider
{
  private quidCompletions: vscode.CompletionItem[] = [];

  constructor(private questionIdCache: QuestionCache) {
    this.updateCompletionItems();

    questionIdCache.onUpdated(() => this.updateCompletionItems());
  }

  private updateCompletionItems() {
    const questionIds = this.questionIdCache.getQuestionIds();
    this.quidCompletions = questionIds.map(
      (qid) =>
        new vscode.CompletionItem(
          qid.localId,
          vscode.CompletionItemKind.Reference,
        ),
    );
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const linePrefix = document
      .lineAt(position)
      .text.slice(0, position.character);

    // Check if we're inside an "id" field value
    const match = linePrefix.match(/"id"\s*:\s*"([^"]*)$/);
    if (!match) {
      return;
    }
    // Calculate the range of the partial text to replace
    const partialText = match[1];
    const startPos = new vscode.Position(
      position.line,
      position.character - partialText.length,
    );
    const range = new vscode.Range(startPos, position);

    // Set the range on each completion item
    return this.quidCompletions.map((item) => ({ ...item, range }));
  }
}

export class QuestionCompletionItemProvider
  implements vscode.CompletionItemProvider
{
  private tagCompletions: vscode.CompletionItem[] = [];

  constructor(private questionIdCache: QuestionCache) {
    this.updateCompletionItems();

    questionIdCache.onUpdated(() => this.updateCompletionItems());
  }

  private updateCompletionItems() {
    const tags = this.questionIdCache.getTags();
    this.tagCompletions = tags.map(
      (t) => new vscode.CompletionItem(t, vscode.CompletionItemKind.EnumMember),
    );
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const startLine = document.lineAt(position);
    let line = startLine;
    while (!line.text.includes(":")) {
      if (line.lineNumber <= 0) {
        return;
      }
      line = document.lineAt(line.lineNumber - 1);
    }
    if (!line.text.includes("tags")) {
      return;
    }
    const match = startLine.text
      .slice(0, position.character)
      .match(/"([^"]*)$/);
    if (!match) {
      return;
    }
    // Calculate the range of the partial text to replace
    const partialText = match[1];
    const startPos = new vscode.Position(
      position.line,
      position.character - partialText.length,
    );
    const range = new vscode.Range(startPos, position);
    return this.tagCompletions.map((tc) => ({ ...tc, range }));
  }
}
