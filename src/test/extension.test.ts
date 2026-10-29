import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  invalidRootUuidDiagnosticCode,
  isEmptyUuidValue,
  missingRootUuidDiagnosticCode,
  MissingFileQuickFixProvider,
  UuidCompletionItemProvider,
} from "../providers";

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

const unusedQuestionCode = "prairielearn-navigator/unused-question";

/**
 * Ours only: VS Code's JSON service also reports, e.g., comments in .json.
 * Most fixture questions are unused, so that note is left out unless asked for.
 */
function ourDiagnostics(uri: vscode.Uri, options: { unused?: boolean } = {}): vscode.Diagnostic[] {
  return vscode.languages
    .getDiagnostics(uri)
    .filter((d) => d.source === "prairielearn-navigator")
    .filter((d) => options.unused || d.code !== unusedQuestionCode);
}

async function until<T>(get: () => T, done: (value: T) => boolean): Promise<T> {
  let value = get();
  for (let i = 0; i < 100 && !done(value); i++) {
    await new Promise((r) => setTimeout(r, 100));
    value = get();
  }
  return value;
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

function positionAfter(doc: vscode.TextDocument, text: string): vscode.Position {
  return doc.positionAt(doc.getText().indexOf(text) + text.length);
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

  test("uuid completion uses the configured command", async () => {
    const settings = vscode.workspace.getConfiguration("prairielearn-navigator");
    const uuid = "12345678-1234-4123-8123-123456789abc";
    try {
      await settings.update(
        "uuidCommand",
        `printf ${uuid}`,
        vscode.ConfigurationTarget.Workspace,
      );
      const doc = await vscode.workspace.openTextDocument({
        content: `{\n  "uuid": ""\n}`,
        language: "json",
      });
      const position = positionAfter(doc, `"uuid": "`);
      assert.ok(isEmptyUuidValue(doc, position));

      const provider = new UuidCompletionItemProvider();
      const completions = await provider.provideCompletionItems(
        doc,
        position,
        new vscode.CancellationTokenSource().token,
      );

      const item = completions?.find((candidate) => candidate.label === uuid);
      assert.ok(item);
      assert.strictEqual(item.kind, vscode.CompletionItemKind.Event);
      assert.strictEqual(item.detail, "Generate a new UUID");
      assert.ok(item.range instanceof vscode.Range && item.range.isEmpty);

      const missingDoc = await vscode.workspace.openTextDocument({
        content: `{\n  "title": "Missing UUID"\n}`,
        language: "json",
      });
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        "root must have required property 'uuid' (PL schema test)",
        vscode.DiagnosticSeverity.Error,
      );
      diagnostic.code = missingRootUuidDiagnosticCode;
      const actions = await new MissingFileQuickFixProvider().provideCodeActions(
        missingDoc,
        diagnostic.range,
        {
          diagnostics: [diagnostic],
          only: vscode.CodeActionKind.QuickFix,
          triggerKind: vscode.CodeActionTriggerKind.Invoke,
        },
        new vscode.CancellationTokenSource().token,
      );
      const fix = actions.find((action) => action.title === "Add generated UUID");
      assert.ok(fix?.command);
      await vscode.commands.executeCommand(
        fix.command.command,
        ...(fix.command.arguments ?? []),
      );
      const value = JSON.parse(missingDoc.getText()) as Record<string, unknown>;
      assert.deepStrictEqual(Object.keys(value)[0], "uuid");
      assert.strictEqual(value.uuid, uuid);

      const invalidDoc = await vscode.workspace.openTextDocument({
        content: `{\n  "uuid": "a",\n  "title": "Invalid UUID"\n}`,
        language: "json",
      });
      const invalidDiagnostic = new vscode.Diagnostic(
        new vscode.Range(1, 10, 1, 13),
        '/uuid must match pattern "..." (PL schema test)',
        vscode.DiagnosticSeverity.Error,
      );
      invalidDiagnostic.code = invalidRootUuidDiagnosticCode;
      const invalidActions =
        new MissingFileQuickFixProvider().provideCodeActions(
          invalidDoc,
          invalidDiagnostic.range,
          {
            diagnostics: [invalidDiagnostic],
            only: vscode.CodeActionKind.QuickFix,
            triggerKind: vscode.CodeActionTriggerKind.Invoke,
          },
          new vscode.CancellationTokenSource().token,
        );
      const replacement = invalidActions.find(
        (action) => action.title === "Replace with generated UUID",
      );
      assert.ok(replacement?.command);
      await vscode.commands.executeCommand(
        replacement.command.command,
        ...(replacement.command.arguments ?? []),
      );
      const replaced = JSON.parse(invalidDoc.getText()) as Record<
        string,
        unknown
      >;
      assert.strictEqual(replaced.uuid, uuid);
    } finally {
      await settings.update(
        "uuidCommand",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      fs.rmSync(path.join(course, ".vscode"), { recursive: true, force: true });
    }
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

  test("an unused question is noted on its title, live as assessments change", async () => {
    const unused = () =>
      ourDiagnostics(depsInfo, { unused: true }).filter((d) => d.code === unusedQuestionCode);
    const noted = await until(unused, (ds) => ds.length === 1);
    assert.deepStrictEqual(
      noted.map((d) => [d.severity, d.range.start.line, d.message]),
      [[vscode.DiagnosticSeverity.Information, 2, 'question "deps" is not used by any assessment']]
    );

    const editor = await vscode.window.showTextDocument(assessment);
    try {
      const at = positionOf(editor.document, '{ "id": "good"').translate(0, -1);
      await editor.edit((e) => e.insert(at, '{ "id": "deps", "points": 1 },\n        '));
      assert.deepStrictEqual(await until(unused, (ds) => ds.length === 0), []);
    } finally {
      await vscode.commands.executeCommand("workbench.action.files.revert");
    }
    assert.strictEqual((await until(unused, (ds) => ds.length === 1)).length, 1);
  });

  test("unused tags and assessment sets are flagged live as questions and assessments change", async () => {
    const infoCourse = vscode.Uri.file(path.join(course, "infoCourse.json"));
    const unusedNames = () =>
      ourDiagnostics(infoCourse)
        .filter((d) => /unused-(tag|assessment-set)$/.test(String(d.code)))
        .map((d) => [d.severity, d.message]);
    const courseEditor = await vscode.window.showTextDocument(infoCourse);
    try {
      const end = courseEditor.document.positionAt(courseEditor.document.getText().lastIndexOf("}"));
      await courseEditor.edit((e) =>
        e.insert(
          end,
          ', "tags": [{ "name": "t1", "color": "red1" }], "assessmentSets": [' +
            '{ "abbreviation": "HW", "name": "Homework", "heading": "Homework", "color": "green1" }, ' +
            '{ "abbreviation": "Q", "name": "Quiz", "heading": "Quizzes", "color": "red1" }] '
        )
      );
      assert.deepStrictEqual(await until(unusedNames, (ds) => ds.length === 2), [
        [vscode.DiagnosticSeverity.Warning, 'tag "t1" is not used by any question'],
        [vscode.DiagnosticSeverity.Warning, 'assessment set "Quiz" is not used by any assessment'],
      ]);

      const questionEditor = await vscode.window.showTextDocument(depsInfo);
      try {
        await questionEditor.edit((e) => e.insert(new vscode.Position(0, 1), '\n  "tags": ["t1"],'));
        assert.deepStrictEqual(await until(unusedNames, (ds) => ds.length === 1), [
          [vscode.DiagnosticSeverity.Warning, 'assessment set "Quiz" is not used by any assessment'],
        ]);
      } finally {
        await vscode.commands.executeCommand("workbench.action.files.revert");
      }
      assert.strictEqual((await until(unusedNames, (ds) => ds.length === 2)).length, 2);
    } finally {
      await vscode.window.showTextDocument(infoCourse);
      await vscode.commands.executeCommand("workbench.action.files.revert");
    }
  });

  test("the unusedQuestions setting sets the note's severity", async () => {
    const settings = vscode.workspace.getConfiguration("prairielearn-navigator");
    const unused = () =>
      ourDiagnostics(depsInfo, { unused: true }).filter((d) => d.code === unusedQuestionCode);
    try {
      await settings.update("unusedQuestions", "error", vscode.ConfigurationTarget.Workspace);
      const errors = await until(unused, (ds) =>
        ds.length === 1 && ds[0].severity === vscode.DiagnosticSeverity.Error
      );
      assert.deepStrictEqual(errors.map((d) => d.severity), [vscode.DiagnosticSeverity.Error]);

      await settings.update("unusedQuestions", "ignored", vscode.ConfigurationTarget.Workspace);
      assert.deepStrictEqual(await until(unused, (ds) => ds.length === 0), []);
    } finally {
      await settings.update("unusedQuestions", undefined, vscode.ConfigurationTarget.Workspace);
      fs.rmSync(path.join(course, ".vscode"), { recursive: true, force: true });
    }
  });

  test("a dedicated rule setting sets the diagnostic severity", async () => {
    const settings = vscode.workspace.getConfiguration("prairielearn-navigator");
    const missing = () =>
      ourDiagnostics(depsInfo).filter(
        (d) => d.code === "prairielearn-navigator/client-files-course-exist"
      );
    try {
      await settings.update(
        "diagnostics.client-files-course-exist",
        "info",
        vscode.ConfigurationTarget.Workspace
      );
      const infos = await until(missing, (ds) =>
        ds.length === 2 && ds.every((d) => d.severity === vscode.DiagnosticSeverity.Information)
      );
      assert.deepStrictEqual(
        infos.map((d) => d.severity),
        [vscode.DiagnosticSeverity.Information, vscode.DiagnosticSeverity.Information]
      );

      await settings.update(
        "diagnostics.client-files-course-exist",
        "off",
        vscode.ConfigurationTarget.Workspace
      );
      assert.deepStrictEqual(await until(missing, (ds) => ds.length === 0), []);
    } finally {
      await settings.update(
        "diagnostics.client-files-course-exist",
        undefined,
        vscode.ConfigurationTarget.Workspace
      );
      fs.rmSync(path.join(course, ".vscode"), { recursive: true, force: true });
    }
  });

  test("a question directory without info.json is an error on its first file, live as info.json comes and goes", async () => {
    const dir = path.join(course, "questions/onlyServer");
    const serverPy = vscode.Uri.file(path.join(dir, "server.py"));
    const missing = () =>
      ourDiagnostics(serverPy)
        .filter((d) => d.code === "prairielearn-navigator/question-info-missing")
        .map((d) => [d.severity, d.range.start.line, d.message]);
    assert.deepStrictEqual(await until(missing, (ds) => ds.length === 1), [[
      vscode.DiagnosticSeverity.Error,
      0,
      'directory "onlyServer" in questions/ has files but no info.json: PrairieLearn will fail to load it ' +
        "from disk (Missing JSON file: questions/onlyServer/info.json)",
    ]]);

    const infoJson = path.join(dir, "info.json");
    try {
      fs.writeFileSync(infoJson, '{ "uuid": "c7c9d1d6-3d3e-4f0e-9c55-1f0a6b4f1e11", "title": "t", "topic": "t", "type": "v3" }');
      assert.deepStrictEqual(await until(missing, (ds) => ds.length === 0), []);
    } finally {
      fs.rmSync(infoJson, { force: true });
    }
    assert.strictEqual((await until(missing, (ds) => ds.length === 1)).length, 1);
  });

  test("the missingQuestionInfo setting sets that error's severity", async () => {
    const settings = vscode.workspace.getConfiguration("prairielearn-navigator");
    const serverPy = vscode.Uri.file(path.join(course, "questions/onlyServer/server.py"));
    const missing = () =>
      ourDiagnostics(serverPy).filter((d) => d.code === "prairielearn-navigator/question-info-missing");
    try {
      await settings.update("missingQuestionInfo", "warning", vscode.ConfigurationTarget.Workspace);
      const warnings = await until(missing, (ds) =>
        ds.length === 1 && ds[0].severity === vscode.DiagnosticSeverity.Warning
      );
      assert.deepStrictEqual(warnings.map((d) => d.severity), [vscode.DiagnosticSeverity.Warning]);

      await settings.update("missingQuestionInfo", "ignored", vscode.ConfigurationTarget.Workspace);
      assert.deepStrictEqual(await until(missing, (ds) => ds.length === 0), []);
    } finally {
      await settings.update("missingQuestionInfo", undefined, vscode.ConfigurationTarget.Workspace);
      fs.rmSync(path.join(course, ".vscode"), { recursive: true, force: true });
    }
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
