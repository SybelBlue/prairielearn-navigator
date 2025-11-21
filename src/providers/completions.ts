import * as vscode from "vscode";
import { QuestionCache } from "./filewatchers";

export class AssessmentCompletionItemProvider
  implements vscode.CompletionItemProvider
{
  private completionItems: vscode.CompletionItem[] = [];

  constructor(private questionIdCache: QuestionCache) {
    this.updateCompletionItems();

    questionIdCache.onDidChange(() => this.updateCompletionItems());
  }

  private updateCompletionItems() {
    const questionIds = this.questionIdCache.getQuestionIds();
    this.completionItems = questionIds.map(
      (qid) =>
        new vscode.CompletionItem(
          qid.localId,
          vscode.CompletionItemKind.Reference
        )
    );
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | undefined> {
    const linePrefix = document
      .lineAt(position)
      .text.slice(0, position.character);

    // Check if we're inside an "id" field value
    const match = linePrefix.match(/"id"\s*:\s*"([^"]*)$/);
    if (!match) {
      return undefined;
    }

    // Calculate the range of the partial text to replace
    const partialText = match[1];
    const startPos = new vscode.Position(
      position.line,
      position.character - partialText.length
    );
    const range = new vscode.Range(startPos, position);

    // Set the range on each completion item
    return this.completionItems.map((item) => {
      const newItem = new vscode.CompletionItem(item.label, item.kind);
      newItem.range = range;
      return newItem;
    });
  }
}
