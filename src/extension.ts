// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

function getQuestionDirFromId(
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
  dir: string;
  infoJson: string;
  questionHtml: string;
  serverPy: string;
};

function questionFilePathsFromId(
  document: vscode.TextDocument,
  questionId: string
): (QuestionPaths & { strict(): Partial<QuestionPaths> }) | null {
  const dir = getQuestionDirFromId(document, questionId);

  if (!dir || !fs.existsSync(dir)) {
    return null;
  }

  const infoJson = path.join(dir, "info.json");
  const html = path.join(dir, "question.html");
  const serverPy = path.join(dir, "server.py");
  return {
    dir,
    infoJson,
    questionHtml: html,
    serverPy,
    /** Only returns existing file-paths */
    strict(): Partial<QuestionPaths> {
      const out: Partial<QuestionPaths> = {};
      if (fs.existsSync(dir)) {
        out.dir = dir;
      }
      if (fs.existsSync(infoJson)) {
        out.infoJson = infoJson;
      }
      if (fs.existsSync(html)) {
        out.questionHtml = html;
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

class QuestionIdCache {
  private questionIds: string[] = [];
  private fileWatcher: vscode.FileSystemWatcher;
  private onDidChangeEmitter = new vscode.EventEmitter<string[]>();

  // Event that providers can subscribe to
  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor() {
    this.fileWatcher =
      vscode.workspace.createFileSystemWatcher("**/questions/**");

    this.fileWatcher.onDidCreate(() => this.refresh());
    this.fileWatcher.onDidDelete(() => this.refresh());
    this.fileWatcher.onDidChange(() => this.refresh());

    this.refresh();
  }

  private async refresh() {
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

class AssessmentDefinitionProvider implements vscode.DefinitionProvider {
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

    const questionDirPath = getQuestionDirFromId(document, questionId);

    if (!questionDirPath || !fs.existsSync(questionDirPath)) {
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

class AssessmentCodeLensProvider implements vscode.CodeLensProvider {
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

      for (const [key, p] of Object.entries(questionPaths.strict())) {
        if (key !== "dir") {
          lenses.push(
            new vscode.CodeLens(matchRange, {
              title: `${path.basename(p)}`,
              command: "prairielearn-navigator.openFile",
              arguments: [p],
            })
          );
        }
      }
    }

    return lenses;
  }
}

class QuestionHeaderCodeLensProvider implements vscode.CodeLensProvider {
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
class AssessmentCompletionItemProvider
  implements vscode.CompletionItemProvider
{
  private completionItems: vscode.CompletionItem[] = [];

  constructor(private questionIdCache: QuestionIdCache) {
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

abstract class ReferenceBasedDiagnosticCollection {
  protected collection: vscode.DiagnosticCollection;
  constructor(questionCache: QuestionIdCache) {
    this.collection = vscode.languages.createDiagnosticCollection(
      "prairielearn-navigator"
    );

    questionCache.onDidChange(() => this.updateOpenDocuments());

    // Check already open documents once on init
    this.updateOpenDocuments();
  }

  updateOpenDocuments() {
    vscode.workspace.textDocuments.forEach((doc) => {
      this.update(doc);
    });
  }

  subscriptions(): vscode.Disposable[] {
    return [
      this.collection,

      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.update(doc);
      }),

      vscode.workspace.onDidChangeTextDocument((e) => {
        this.update(e.document);
      }),
    ];
  }

  private update(document: vscode.TextDocument) {
    const ds = this.diagnosticsFor(document);
    if (ds === null || ds === undefined) {
      return;
    }
    this.collection.set(document.uri, ds);
  }

  protected abstract diagnosticsFor(
    document: vscode.TextDocument
  ): vscode.Diagnostic[] | null | undefined;
}

class DuplicatedQuestionDiagnosticCollection extends ReferenceBasedDiagnosticCollection {
  protected diagnosticsFor(document: vscode.TextDocument) {
    if (!document.uri.fsPath.endsWith("infoAssessment.json")) {
      return;
    }
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();

    try {
      const idPositions = new Map<string, number[]>();

      // Find all "id" field positions
      const idMatches = Array.from(text.matchAll(/"id"\s*:\s*"([^"]+)"/g));

      for (const match of idMatches) {
        const id = match[1];
        const offset = match.index! + match[0].indexOf(id);

        if (!idPositions.has(id)) {
          idPositions.set(id, []);
        }
        idPositions.get(id)!.push(offset);
      }

      // Create diagnostics for duplicates
      for (const [id, positions] of idPositions) {
        if (positions.length > 1) {
          for (const offset of positions) {
            const start = document.positionAt(offset);
            const end = document.positionAt(offset + id.length);
            const range = new vscode.Range(start, end);

            const diagnostic = new vscode.Diagnostic(
              range,
              `Duplicate question ID: "${id}" appears ${positions.length} times`,
              vscode.DiagnosticSeverity.Warning
            );

            diagnostics.push(diagnostic);
          }
        }
      }
    } catch (e) {
      console.error("prairielearn -- error in duplicate diagnostics: " + e);
    }

    return diagnostics;
  }
}

class IncompleteQuestionDiagnosticCollection extends ReferenceBasedDiagnosticCollection {
  protected diagnosticsFor(document: vscode.TextDocument) {
    if (!document.uri.fsPath.endsWith("infoAssessment.json")) {
      return;
    }
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();

    // Find all "id" field positions
    const idMatches = Array.from(text.matchAll(/"id"\s*:\s*"([^"]+)"/g));

    for (const match of idMatches) {
      const id = match[1];

      const paths = questionFilePathsFromId(document, id);

      const endOffset = match.index + match[0].length;
      const range = new vscode.Range(
        document.positionAt(endOffset - (id.length + 1)),
        document.positionAt(endOffset - 1)
      );

      let existingPaths;
      if (!paths || !(existingPaths = paths.strict()).dir) {
        const diagnostic = new vscode.Diagnostic(
          range,
          `missing question: expected question directory ${
            "${workspaceRoot}/questions/" + id
          }`,
          vscode.DiagnosticSeverity.Error
        );
        diagnostics.push(diagnostic);
        continue;
      }
      if (!existingPaths.infoJson) {
        const diagnostic = new vscode.Diagnostic(
          range,
          `incomplete question: missing required JSON file`,
          vscode.DiagnosticSeverity.Error
        );

        diagnostic.relatedInformation = [
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(
              vscode.Uri.file(paths.infoJson),
              new vscode.Range(0, 0, 0, 0)
            ),
            "Expected location of info.json"
          ),
        ];
        diagnostics.push(diagnostic);
      }
      if (!existingPaths.questionHtml) {
        const diagnostic = new vscode.Diagnostic(
          range,
          `incomplete question: missing required html file`,
          vscode.DiagnosticSeverity.Error
        );

        diagnostic.relatedInformation = [
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(
              vscode.Uri.file(paths.questionHtml),
              new vscode.Range(0, 0, 0, 0)
            ),
            "Expected location of question.html"
          ),
        ];
        diagnostics.push(diagnostic);
      }
    }

    return diagnostics;
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

  const cache = new QuestionIdCache();

  cache.onDidChange((ids) =>
    console.info(`prairielearn -- cache update ${ids}`)
  );

  context.subscriptions.push(
    // Shared Utilities
    cache,

    // Diagnostics
    ...new DuplicatedQuestionDiagnosticCollection(cache).subscriptions(),
    ...new IncompleteQuestionDiagnosticCollection(cache).subscriptions(),

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
      new AssessmentDefinitionProvider()
    ),

    // Completion Providers
    vscode.languages.registerCompletionItemProvider(
      infoAssessmentPatterns,
      new AssessmentCompletionItemProvider(cache),
      `"`
    ),

    // CodeLens Providers
    vscode.languages.registerCodeLensProvider(
      infoAssessmentPatterns,
      new AssessmentCodeLensProvider()
    ),
    vscode.languages.registerCodeLensProvider(
      [
        { pattern: "**/questions/**/info.json" },
        { pattern: "**/questions/**/question.html" },
        { pattern: "**/questions/**/server.py" },
      ],
      new QuestionHeaderCodeLensProvider()
    )
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
