import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const course = path.resolve(__dirname, "../../src/test-cli/fixtures/broken");
const depsInfo = vscode.Uri.file(path.join(course, "questions/deps/info.json"));
const assessment = vscode.Uri.file(
  path.join(course, "courseInstances/Fa26/assessments/hw1/infoAssessment.json")
);
const nestedQuestion = path.join(course, "questions/topic/nested");

async function show(file: string): Promise<vscode.TextEditor> {
  return vscode.window.showTextDocument(vscode.Uri.file(file));
}

async function runQuestionSourceCommand(command: string): Promise<string> {
  await vscode.commands.executeCommand(
    `prairielearn-navigator.${command}`,
  );
  return vscode.window.activeTextEditor?.document.uri.fsPath ?? "";
}

/** Ours only: VS Code's JSON service also reports, e.g., comments in .json. */
function ourDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages
    .getDiagnostics(uri)
    .filter((d) => d.source === "prairielearn-navigator");
}

async function diagnosticsFor(uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
  for (let i = 0; i < 100; i++) {
    const ds = ourDiagnostics(uri);
    if (ds.length > 0) {
      return ds;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

function positionOf(doc: vscode.TextDocument, text: string): vscode.Position {
  return doc.positionAt(doc.getText().indexOf(text) + 1);
}

suite("PrairieLearn Navigator", () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension("sybelblue.prairielearn-navigator")?.activate();
  });

  test("missing clientFilesCourse dependencies are diagnosed", async () => {
    await vscode.window.showTextDocument(depsInfo);
    const ds = await diagnosticsFor(depsInfo);
    assert.deepStrictEqual(
      ds.map((d) => [d.code, d.message]).sort(),
      [
        ["prairielearn-navigator/client-files-course-exist", "\"../escape.js\" must be a path inside clientFilesCourse/"],
        ["prairielearn-navigator/client-files-course-exist", "file not found: clientFilesCourse/missing.css"],
      ]
    );
  });

  test("files that were never opened are checked too", async () => {
    const neverOpened = vscode.Uri.file(path.join(course, "questions/jsonRefs/info.json"));
    assert.ok(!vscode.workspace.textDocuments.some((d) => d.uri.fsPath === neverOpened.fsPath));
    const ds = await diagnosticsFor(neverOpened);
    assert.deepStrictEqual(
      ds.map((d) => String(d.code).replace("prairielearn-navigator/", "")).sort(),
      ["client-files-question-exist", "client-files-question-exist", "server-files-course-exist"]
    );
  });

  test("clientFilesCourse dependencies jump to their file", async () => {
    const doc = await vscode.workspace.openTextDocument(depsInfo);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      doc.uri,
      positionOf(doc, "exists.css")
    );
    assert.deepStrictEqual(
      locations.map((l) => l.uri.fsPath),
      [path.join(course, "clientFilesCourse/exists.css")]
    );

    const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
      "vscode.executeLinkProvider",
      doc.uri
    );
    const targets = links.map((l) => l.target?.fsPath);
    assert.ok(targets.includes(path.join(course, "clientFilesCourse/exists.css")));
    assert.ok(!targets.some((t) => t?.endsWith("missing.css")));
  });

  test("pl-figure file names jump to the figure", async () => {
    const html = vscode.Uri.file(path.join(course, "questions/figures/question.html"));
    const doc = await vscode.workspace.openTextDocument(html);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      doc.uri,
      positionOf(doc, "img/here.png")
    );
    assert.deepStrictEqual(
      locations.map((l) => l.uri.fsPath),
      [path.join(course, "questions/figures/clientFilesQuestion/img/here.png")]
    );
    const ds = await diagnosticsFor(html);
    assert.strictEqual(ds.length, 4);
    assert.ok(ds.every((d) => d.code === "prairielearn-navigator/pl-figure-file-exist"));
  });

  test("assessment question ids jump to the question", async () => {
    const doc = await vscode.workspace.openTextDocument(assessment);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      doc.uri,
      positionOf(doc, "topic/nested")
    );
    assert.deepStrictEqual(
      locations.map((l) => l.uri.fsPath),
      [path.join(course, "questions/topic/nested/question.html")]
    );
  });

  test("Find All References on a reference lists every use of its file", async () => {
    const doc = await vscode.workspace.openTextDocument(depsInfo);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      doc.uri,
      positionOf(doc, "exists.css")
    );
    assert.deepStrictEqual(
      locations.map((l) => `${path.relative(course, l.uri.fsPath)}:${l.range.start.line + 1}`).sort(),
      ["elements/my-el/info.json:1", "questions/deps/info.json:7", "questions/figures/question.html:4"]
    );
  });

  test("a referenced file shows its uses in a CodeLens", async () => {
    const css = await vscode.workspace.openTextDocument(
      path.join(course, "clientFilesCourse/exists.css")
    );
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      css.uri
    );
    const titles = lenses.map((l) => l.command?.title);
    assert.ok(titles.includes("3 uses in 3 files"), JSON.stringify(titles));
  });

  test("Find Uses works for files that cannot be opened as text", async () => {
    const png = vscode.Uri.file(
      path.join(course, "questions/figures/clientFilesQuestion/img/here.png")
    );
    const shown = await vscode.commands.executeCommand<vscode.Location[]>(
      "prairielearn-navigator.findUses",
      png
    );
    assert.deepStrictEqual(
      shown?.map((l) => path.relative(course, l.uri.fsPath)),
      ["questions/figures/question.html"]
    );
  });

  test("question header lenses still count assessment uses", async () => {
    const goodHtml = await vscode.workspace.openTextDocument(
      path.join(course, "questions/good/question.html")
    );
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      goodHtml.uri
    );
    const titles = lenses.map((l) => l.command?.title);
    assert.ok(titles.includes("2 references"), JSON.stringify(titles));
  });

  test("question source commands open every canonical sibling", async () => {
    const infoJson = path.join(nestedQuestion, "info.json");
    const questionHtml = path.join(nestedQuestion, "question.html");
    const serverPy = path.join(nestedQuestion, "server.py");

    await show(infoJson);
    assert.strictEqual(
      await runQuestionSourceCommand("openQuestionHtml"),
      questionHtml,
    );
    assert.strictEqual(
      await runQuestionSourceCommand("openQuestionServerPy"),
      serverPy,
    );
    assert.strictEqual(
      await runQuestionSourceCommand("openQuestionInfoJson"),
      infoJson,
    );
  });

  test("question source commands resolve nested and client files", async () => {
    const helper = path.join(
      nestedQuestion,
      "clientFilesQuestion/helper.js",
    );
    await show(helper);
    assert.strictEqual(
      await runQuestionSourceCommand("openQuestionServerPy"),
      path.join(nestedQuestion, "server.py"),
    );
  });

  test("the command for the active canonical source is a no-op", async () => {
    const questionHtml = path.join(nestedQuestion, "question.html");
    const editor = await show(questionHtml);
    assert.strictEqual(
      await runQuestionSourceCommand("openQuestionHtml"),
      questionHtml,
    );
    assert.strictEqual(vscode.window.activeTextEditor, editor);
  });

  test("a missing optional question source is not created or opened", async () => {
    const infoJson = path.join(course, "questions/noHtml/info.json");
    const missingHtml = path.join(course, "questions/noHtml/question.html");
    await show(infoJson);
    assert.ok(!fs.existsSync(missingHtml));
    assert.strictEqual(
      await runQuestionSourceCommand("openQuestionHtml"),
      infoJson,
    );
    assert.ok(!fs.existsSync(missingHtml));
  });

  test("a non-question file does not resolve to a question", async () => {
    const infoCourse = path.join(course, "infoCourse.json");
    await show(infoCourse);
    assert.strictEqual(
      await runQuestionSourceCommand("openQuestionHtml"),
      infoCourse,
    );
  });

  test("the manifest keeps source actions visible while disabling them", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"),
    ) as {
      contributes: {
        commands: {
          command: string;
          enablement?: string;
        }[];
        menus: {
          "editor/title": {
            command: string;
            when: string;
            group: string;
          }[];
        };
      };
    };
    const prefix = "prairielearn-navigator.openQuestion";
    const sourceCommands = manifest.contributes.commands.filter((item) =>
      item.command.startsWith(prefix),
    );
    const titleItems = manifest.contributes.menus["editor/title"];

    assert.deepStrictEqual(
      titleItems.map((item) => [item.command, item.when, item.group]),
      [
        [`${prefix}Html`, "prairielearn-navigator.inQuestion", "navigation@1"],
        [
          `${prefix}InfoJson`,
          "prairielearn-navigator.inQuestion",
          "navigation@2",
        ],
        [
          `${prefix}ServerPy`,
          "prairielearn-navigator.inQuestion",
          "navigation@3",
        ],
      ],
    );
    assert.deepStrictEqual(
      sourceCommands.map((item) => [item.command, item.enablement]),
      [
        [
          `${prefix}Html`,
          "prairielearn-navigator.inQuestion && prairielearn-navigator.questionHtmlExists && prairielearn-navigator.currentQuestionFile != questionHtml",
        ],
        [
          `${prefix}InfoJson`,
          "prairielearn-navigator.inQuestion && prairielearn-navigator.infoJsonExists && prairielearn-navigator.currentQuestionFile != infoJson",
        ],
        [
          `${prefix}ServerPy`,
          "prairielearn-navigator.inQuestion && prairielearn-navigator.serverPyExists && prairielearn-navigator.currentQuestionFile != serverPy",
        ],
      ],
    );
    assert.ok(
      titleItems.every((item) => !item.when.includes("currentQuestionFile")),
    );
  });

  test(".vscode/settings.json overrides the course config", async () => {
    const settings = vscode.workspace.getConfiguration("prairielearn-navigator");
    try {
      await settings.update(
        "rules",
        { "client-files-course-exist": "warning" },
        vscode.ConfigurationTarget.Workspace
      );
      let severities: vscode.DiagnosticSeverity[] = [];
      for (let i = 0; i < 50; i++) {
        severities = ourDiagnostics(depsInfo).map((d) => d.severity);
        if (severities.length > 0 && severities.every((s) => s === vscode.DiagnosticSeverity.Warning)) {
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.deepStrictEqual(severities, [
        vscode.DiagnosticSeverity.Warning,
        vscode.DiagnosticSeverity.Warning,
      ]);
    } finally {
      await settings.update("rules", undefined, vscode.ConfigurationTarget.Workspace);
      fs.rmSync(path.join(course, ".vscode"), { recursive: true, force: true });
    }
  });
});
