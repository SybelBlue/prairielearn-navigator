// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

function questionDirFromId(
  document: vscode.TextDocument,
  questionId: string
): null | string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    return null;
  }

  return path.join(workspaceFolder.uri.fsPath, "questions", questionId);
}

type QuestionPaths = {
  infoJson: string;
  html: string;
  serverPy: string;
};

function questionFilePathsFromId(
  document: vscode.TextDocument,
  questionId: string
): (QuestionPaths & { dir: string; strict(): Partial<QuestionPaths> }) | null {
  const dir = questionDirFromId(document, questionId);

  if (!dir || !fs.existsSync(dir)) {
    console.log(`prairielearn -- directory ${dir} DNE`);
    return null;
  }

  const infoJson = path.join(dir, "info.json");
  const html = path.join(dir, "question.html");
  const serverPy = path.join(dir, "server.py");
  return {
    dir,
    infoJson,
    html,
    serverPy,
    /** Only returns existing file-paths */
    strict(): Partial<QuestionPaths> {
      const out: Partial<QuestionPaths> = {};
      if (fs.existsSync(infoJson)) {
        out.infoJson = infoJson;
      }
      if (fs.existsSync(html)) {
        out.html = html;
      }
      if (fs.existsSync(serverPy)) {
        out.serverPy = serverPy;
      }
      return out;
    },
  };
}

function getQuestionIdFromUri(questionUri: vscode.Uri): string {
  const pathParts = questionUri.fsPath.split(path.sep);
  const questionsIndex = pathParts.indexOf("questions");
  return path.join(...pathParts.slice(questionsIndex + 1, -1));
}

class PrairieLearnQuestionIdCache {
  private questionIds: string[] = [];
  private fileWatcher: vscode.FileSystemWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<string[]>();

  // Event that providers can subscribe to
  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor() {
    this.fileWatcher = vscode.workspace.createFileSystemWatcher("**/questions");

    this.fileWatcher.onDidCreate(() => this.refresh());
    this.fileWatcher.onDidDelete(() => this.refresh());
    this.fileWatcher.onDidChange(() => this.refresh());

    this.refresh();
  }

  private async refresh() {
    console.log("prairielearn -- question id cache refresh");
    const questionInfoJsons = await vscode.workspace.findFiles(
      "**/questions/**/info.json"
    );
    this.questionIds = questionInfoJsons.map((uri) =>
      getQuestionIdFromUri(uri)
    );
    this.onDidChangeEmitter.fire(this.questionIds);
  }

  public getQuestionIds(): string[] {
    return [...this.questionIds];
  }

  public dispose() {
    this.fileWatcher.dispose();
    this.onDidChangeEmitter.dispose();
  }
}

class PrairieLearnAssessmentDefinitionProvider
  implements vscode.DefinitionProvider
{
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition> {
    function isQuestionId(obj: any, value: string): boolean {
      if (typeof obj !== "object" || obj === null) {
        return false;
      }

      for (const key in obj) {
        if (key === "id" && obj[key] === value) {
          return true;
        }
        if (typeof obj[key] === "object" && isQuestionId(obj[key], value)) {
          return true;
        }
      }

      return false;
    }

    function getConfirmedQuestionId(
      document: vscode.TextDocument,
      position: vscode.Position,
      range: vscode.Range
    ): string | null {
      console.log("prairielearn -- falling back to old parser");

      const line = document.lineAt(position.line).text;
      const idMatch = line.match(/"id"\s*:\s*"([^"]+)"/);

      if (idMatch) {
        return idMatch[1]; // e.g., "ch02/difficult"
      }

      try {
        // try to determine by parsing the entire JSON document
        const json = JSON.parse(document.getText());
        const clickedText = document.getText(range).replace(/"/g, "");

        return isQuestionId(json, clickedText) ? clickedText : null;
      } catch (e) {
        if (!(e instanceof SyntaxError)) {
          console.error("prairielearn -- unexpected error parsing json: " + e);
        }
      }

      return null;
    }

    // Get the range of the quoted string at cursor
    const range = document.getWordRangeAtPosition(position, /"([^"]+)"/);
    if (!range) {
      return null;
    }

    const questionId = getConfirmedQuestionId(document, position, range);
    if (!questionId) {
      return null;
    }

    console.log("prairielearn -- questionId:" + questionId);
    const questionDirPath = questionDirFromId(document, questionId);

    if (!questionDirPath || !fs.existsSync(questionDirPath)) {
      console.log(`prairielearn -- directory ${questionDirPath} DNE`);
      return null;
    }

    const questionHtmlPath = path.join(questionDirPath, "question.html");
    const questionInfoJsonPath = path.join(questionDirPath, "info.json");

    const definitionPath = fs.existsSync(questionHtmlPath)
      ? questionHtmlPath
      : questionInfoJsonPath;

    if (!definitionPath) {
      return null;
    }

    return new vscode.Location(
      vscode.Uri.file(definitionPath),
      new vscode.Position(0, 0)
    );
  }
}

class PrairieLearnAssessmentCodeLensProvider
  implements vscode.CodeLensProvider
{
  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();

    const re = /"id"\s*:[\n\s]*"([^"]+)"/gm;
    let match;
    while ((match = re.exec(text))) {
      const questionId = match[1];
      const matchRange = new vscode.Range(
        document.positionAt(match.index),
        document.positionAt(match.index + match[0].length)
      );
      const questionPaths = questionFilePathsFromId(document, questionId);
      if (!questionPaths) {
        lenses.push(
          new vscode.CodeLens(matchRange, {
            title: `!! Unknown Id !!`,
            command: "prairielearn-navigator.unknownId",
            arguments: [questionId],
          })
        );
        continue;
      }

      for (const p of Object.values(questionPaths.strict())) {
        lenses.push(
          new vscode.CodeLens(matchRange, {
            title: `${path.basename(p)}`,
            command: "prairielearn-navigator.openFile",
            arguments: [p],
          })
        );
      }
    }

    return lenses;
  }
}

class PrairieLearnQuestionHeaderCodeLensProvider
  implements vscode.CodeLensProvider
{
  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    const questionId = getQuestionIdFromUri(document.uri);
    const occurrences = await this.findOccurrences(questionId);
    const firstLine = new vscode.Range(0, 0, 0, 0);

    lenses.push(
      new vscode.CodeLens(firstLine, {
        title:
          `${occurrences.length} reference` +
          (occurrences.length === 1 ? "" : "s"),
        command: "prairielearn-navigator.showOccurrences",
        arguments: [occurrences],
      })
    );

    if (occurrences.length < 5) {
      for (const occ of occurrences) {
        const title = this.getAssessmentLabelFromUri(occ.uri);
        lenses.push(
          new vscode.CodeLens(firstLine, {
            title,
            command: "prairielearn-navigator.openFile",
            arguments: [occ.uri.fsPath, occ.range],
          })
        );
      }
    }

    return lenses;
  }

  private getAssessmentLabelFromUri(uri: vscode.Uri): string {
    const pathParts = uri.fsPath.split(path.sep);
    const instanceIndex = pathParts.indexOf("courseInstances");
    const assessmentsIndex = pathParts.indexOf("assessments");
    return path.join(
      ...pathParts.slice(instanceIndex + 1, assessmentsIndex),
      ...pathParts.slice(assessmentsIndex + 1, -1)
    );
  }

  private async findOccurrences(
    questionId: string
  ): Promise<vscode.Location[]> {
    const as = await vscode.workspace.findFiles(
      "**/assessments/**/infoAssessment.json"
    );
    const re = new RegExp(`"id"\\s*:[\\s\\n]*"${questionId}"`, "gm");
    const out = [];
    for (const uri of as) {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (!doc) {
        return [];
      }
      const docText = doc.getText();
      let match;
      while ((match = re.exec(docText))) {
        const matchEnd = match.index + match[0].length;
        out.push(
          new vscode.Location(
            doc.uri,
            new vscode.Range(
              doc.positionAt(matchEnd - (questionId.length + 1)),
              doc.positionAt(matchEnd - 1)
            )
          )
        );
      }
    }
    return out;
  }
}
class PrairieLearnAssessmentCompletionItemProvider
  implements vscode.CompletionItemProvider
{
  private completionItems: vscode.CompletionItem[] = [];

  constructor(private questionIdCache: PrairieLearnQuestionIdCache) {
    this.updateCompletionItems();

    questionIdCache.onDidChange(() => this.updateCompletionItems());
  }

  private updateCompletionItems() {
    const questionIds = this.questionIdCache.getQuestionIds();
    this.completionItems = questionIds.map(
      (qid) =>
        new vscode.CompletionItem(qid, vscode.CompletionItemKind.Reference)
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

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "prairielearn-navigator" is now active!'
  );

  const infoAssessmentPatterns = [
    { pattern: "**/assessments/**/infoAssessment.json" },
  ];

  const questionIdCache = new PrairieLearnQuestionIdCache();

  context.subscriptions.push(
    // Shared Utilities
    questionIdCache,

    // Commands
    vscode.commands.registerCommand(
      "prairielearn-navigator.openFile",
      async (path: string, selection?: vscode.Range) => {
        await vscode.window.showTextDocument(vscode.Uri.file(path), {
          selection,
        });
      }
    ),
    vscode.commands.registerCommand(
      "prairielearn-navigator.unknownId",
      (questionId: string) => {
        vscode.window.showInformationMessage(
          `question id "${questionId}" does not exist`
        );
      }
    ),
    vscode.commands.registerCommand(
      "prairielearn-navigator.showOccurrences",
      async (occurrences: vscode.Location[]) => {
        if (occurrences.length === 0) {
          vscode.window.showInformationMessage("No references found");
          return;
        }

        // Show in references view
        await vscode.commands.executeCommand(
          "editor.action.showReferences",
          occurrences[0].uri,
          occurrences[0].range.start,
          occurrences
        );
      }
    ),

    // Jump-to-Definition Providers
    vscode.languages.registerDefinitionProvider(
      infoAssessmentPatterns,
      new PrairieLearnAssessmentDefinitionProvider()
    ),

    // Completion Providers
    vscode.languages.registerCompletionItemProvider(
      infoAssessmentPatterns,
      new PrairieLearnAssessmentCompletionItemProvider(questionIdCache),
      `"`
    ),

    // CodeLens Providers
    vscode.languages.registerCodeLensProvider(
      infoAssessmentPatterns,
      new PrairieLearnAssessmentCodeLensProvider()
    ),
    vscode.languages.registerCodeLensProvider(
      [
        { pattern: "**/questions/**/info.json" },
        { pattern: "**/questions/**/question.html" },
        { pattern: "**/questions/**/server.py" },
      ],
      new PrairieLearnQuestionHeaderCodeLensProvider()
    )
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
