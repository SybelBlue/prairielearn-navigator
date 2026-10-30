import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  DiagnosticQuickFixProvider,
  diagnosticRuleId,
  ignoreDiagnostic,
  invalidRootUuidDiagnosticCode,
  isEmptyUuidValue,
  missingRootUuidDiagnosticCode,
  MissingFileQuickFixProvider,
  UuidCompletionItemProvider,
} from "../providers";
import {
  debounceMsForExtensionMode,
  productionDebounceMs,
  testDebounceMs,
} from "../timing";

const fixtures = process.env.PL_NAVIGATOR_VSCODE_TEST_FIXTURES ??
  path.resolve(__dirname, "../../src/test-cli/fixtures");
const course = path.join(fixtures, "broken");
const depsInfo = vscode.Uri.file(path.join(course, "questions/deps/info.json"));
const assessment = vscode.Uri.file(
  path.join(course, "courseInstances/Fa26/assessments/hw1/infoAssessment.json")
);
const nestedQuestion = path.join(course, "questions/topic/nested");

async function show(file: string): Promise<vscode.TextEditor> {
  return vscode.window.showTextDocument(vscode.Uri.file(file));
}

async function runQuestionSourceCommand(command: string): Promise<string> {
  return measurePerformance("question-source-navigation", 200, async () => {
    await vscode.commands.executeCommand(
      `prairielearn-navigator.${command}`,
    );
    return vscode.window.activeTextEditor?.document.uri.fsPath ?? "";
  });
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

async function until<T>(
  get: () => T,
  done: (value: T) => boolean,
  description = "diagnostics to settle",
): Promise<T> {
  const initial = get();
  if (done(initial)) {
    return initial;
  }
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    let fallback: NodeJS.Timeout | undefined;
    let subscription: vscode.Disposable;
    const finish = (value: T) => {
      clearTimeout(timer);
      clearInterval(fallback);
      subscription.dispose();
      resolve(value);
    };
    const check = () => {
      const value = get();
      if (done(value)) {
        finish(value);
      }
    };
    subscription = vscode.languages.onDidChangeDiagnostics(() => check());
    // Some VS Code collection updates do not emit a distinct event. Keep a
    // fine-grained fallback without reintroducing the old 100ms latency tax.
    fallback = setInterval(check, 10);
    timer = setTimeout(() => {
      clearInterval(fallback);
      subscription.dispose();
      reject(new Error(`Timed out after 2000ms waiting for ${description}`));
    }, 2_000);
    // Close the gap between the initial read and subscribing to the event.
    check();
  });
}

async function diagnosticsFor(uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
  return until(
    () => ourDiagnostics(uri),
    (diagnostics) => diagnostics.length > 0,
    `diagnostics for ${uri.fsPath}`,
  );
}

async function measurePerformance<T>(
  action: string,
  budgetMs: number,
  run: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const result = await run();
  const elapsedMs = Math.round((performance.now() - started) * 10) / 10;
  const measurement = {
    action,
    elapsedMs,
    budgetMs,
    overBudget: elapsedMs > budgetMs,
    vscodeVersion: vscode.version,
    platform: `${process.platform}-${process.arch}`,
  };
  if (process.env.PL_NAVIGATOR_REPORT_PERF !== "0") {
    console.log(`PL_NAVIGATOR_PERF ${JSON.stringify(measurement)}`);
    if (measurement.overBudget) {
      console.warn(
        `PL_NAVIGATOR_PERF_WARNING ${action} took ${elapsedMs}ms (budget ${budgetMs}ms)`,
      );
    }
  }
  return result;
}

function diagnosticsUnder(root: string): [vscode.Uri, vscode.Diagnostic[]][] {
  const prefix = root + path.sep;
  return vscode.languages
    .getDiagnostics()
    .filter(([uri]) => uri.fsPath.startsWith(prefix))
    .map(
      ([uri, diagnostics]): [vscode.Uri, vscode.Diagnostic[]] => [
        uri,
        diagnostics.filter(
          (diagnostic) => diagnostic.source === "prairielearn-navigator",
        ),
      ],
    )
    .filter(([, diagnostics]) => diagnostics.length > 0);
}

async function assessmentQuestionCompletions(): Promise<string[]> {
  const document = await vscode.workspace.openTextDocument(assessment);
  const marker = '"id": "good';
  const position = document.positionAt(
    document.getText().indexOf(marker) + '"id": "'.length,
  );
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    document.uri,
    position,
    '"',
  );
  return (completions?.items ?? []).map((item) =>
    typeof item.label === "string" ? item.label : item.label.label,
  );
}

async function waitForBulkQuestionIds(
  prefix: string,
  expected: number,
): Promise<string[]> {
  const deadline = performance.now() + 2_000;
  let ids: string[] = [];
  do {
    ids = (await assessmentQuestionCompletions()).filter((id) =>
      id.startsWith(prefix),
    );
    if (ids.length === expected) {
      return ids;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (performance.now() < deadline);
  throw new Error(
    `Timed out waiting for ${expected} question completions under ${prefix}; found ${ids.length}`,
  );
}

async function runInBatches<T>(
  values: readonly T[],
  batchSize: number,
  run: (value: T, index: number) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < values.length; i += batchSize) {
    await Promise.all(
      values.slice(i, i + batchSize).map((value, j) => run(value, i + j)),
    );
  }
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

  test("extension timing keeps production settling and accelerates tests", () => {
    assert.strictEqual(productionDebounceMs, 300);
    assert.strictEqual(testDebounceMs, 10);
    assert.strictEqual(
      debounceMsForExtensionMode(vscode.ExtensionMode.Production),
      productionDebounceMs,
    );
    assert.strictEqual(
      debounceMsForExtensionMode(vscode.ExtensionMode.Development),
      productionDebounceMs,
    );
    assert.strictEqual(
      debounceMsForExtensionMode(vscode.ExtensionMode.Test),
      testDebounceMs,
    );
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

  test("rule diagnostics offer ignore and configure-severity actions", async () => {
    const diagnostics = await diagnosticsFor(depsInfo);
    const diagnostic = diagnostics.find((candidate) =>
      candidate.message.includes("clientFilesCourse/missing.css")
    );
    assert.ok(diagnostic);
    const document = await vscode.workspace.openTextDocument(depsInfo);
    const actions = new DiagnosticQuickFixProvider({ getCourseIdFor: () => course })
      .provideCodeActions(
        document,
        diagnostic.range,
        {
          diagnostics: [diagnostic],
          only: vscode.CodeActionKind.QuickFix,
          triggerKind: vscode.CodeActionTriggerKind.Invoke,
        }
      );
    const ignore = actions.find((action) => action.title === "Ignore this violation in this file");
    assert.ok(ignore?.command);
    assert.deepStrictEqual(ignore.command.arguments?.[0], {
      courseRoot: course,
      file: depsInfo.fsPath,
      rule: "client-files-course-exist",
      message: diagnostic.message,
      occurrence: 1,
    });
    const configure = actions.find((action) =>
      action.title === "Configure severity for client-files-course-exist…"
    );
    assert.deepStrictEqual(configure?.command, {
      command: "workbench.action.openSettings",
      title: "Configure severity for client-files-course-exist…",
      arguments: [
        "@id:prairielearn-navigator.diagnostics.client-files-course-exist",
      ],
    });
    assert.equal(diagnosticRuleId(missingRootUuidDiagnosticCode), "schema");
  });

  test("unused tags and assessment sets offer removal edits", async () => {
    const cases = [
      {
        rule: "unused-tag",
        title: "Remove unused tag",
        key: "tags",
        content: '{\n  "tags": [{ "name": "used" }, { "name": "unused" }]\n}',
      },
      {
        rule: "unused-assessment-set",
        title: "Remove unused assessment set",
        key: "assessmentSets",
        content:
          '{\n  "assessmentSets": [{ "name": "Homework" }, { "name": "unused" }]\n}',
      },
    ] as const;
    const provider = new DiagnosticQuickFixProvider({ getCourseIdFor: () => "/course" });
    for (const testCase of cases) {
      const document = await vscode.workspace.openTextDocument({
        content: testCase.content,
        language: "json",
      });
      const start = document.positionAt(document.getText().indexOf('"unused"'));
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(start, start.translate(0, '"unused"'.length)),
        "unused",
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = "prairielearn-navigator";
      diagnostic.code = `prairielearn-navigator/${testCase.rule}`;
      const actions = provider.provideCodeActions(
        document,
        diagnostic.range,
        {
          diagnostics: [diagnostic],
          only: vscode.CodeActionKind.QuickFix,
          triggerKind: vscode.CodeActionTriggerKind.Invoke,
        }
      );
      const remove = actions.find((action) => action.title === testCase.title);
      assert.ok(remove?.edit);
      const ignore = actions.find((action) => action.title === "Ignore this violation in this file");
      assert.deepStrictEqual(ignore?.command?.arguments?.[0], {
        courseRoot: "/course",
        file: document.uri.fsPath,
        rule: testCase.rule,
        identifier: "unused",
      });
      assert.equal(await vscode.workspace.applyEdit(remove.edit), true);
      const value = JSON.parse(document.getText()) as Record<string, unknown[]>;
      assert.deepStrictEqual(value[testCase.key], [{ name: testCase.key === "tags" ? "used" : "Homework" }]);
    }
  });

  test("an unused question offers to move its directory to Trash", async () => {
    const unused = await until(
      () => ourDiagnostics(depsInfo, { unused: true }).find((d) => d.code === unusedQuestionCode),
      (diagnostic) => diagnostic !== undefined
    );
    assert.ok(unused);
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      "vscode.executeCodeActionProvider",
      depsInfo,
      unused.range,
      vscode.CodeActionKind.QuickFix.value
    );
    const remove = actions.find(
      (action) => action.title === "Move unused question directory to Trash…"
    );
    assert.deepStrictEqual(remove?.command, {
      command: "prairielearn-navigator.removeUnusedQuestion",
      title: "Move unused question directory to Trash…",
      arguments: [{ courseRoot: course, file: depsInfo.fsPath }],
    });
    const ignore = actions.find((action) => action.title === "Ignore this violation in this file");
    assert.deepStrictEqual(ignore?.command?.arguments?.[0], {
      courseRoot: course,
      file: depsInfo.fsPath,
      rule: "unused-question",
      identifier: "deps",
    });
  });

  test("ignoring a diagnostic creates and extends the course config", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-navigator-ignore-"));
    const file = path.join(root, "questions/q/info.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{}\n");
    try {
      const base = {
        courseRoot: root,
        file,
        rule: "schema" as const,
        message: "missing a property",
      };
      assert.equal(await ignoreDiagnostic({ ...base, occurrence: 1 }), true);
      assert.equal(await ignoreDiagnostic({ ...base, occurrence: 1 }), true);
      assert.equal(await ignoreDiagnostic({ ...base, occurrence: 2 }), true);
      assert.equal(await ignoreDiagnostic({
        courseRoot: root,
        file,
        rule: "unused-question",
        identifier: "q",
      }), true);
      const saved = JSON.parse(
        fs.readFileSync(path.join(root, ".pl-navigator.jsonc"), "utf-8")
      );
      assert.deepStrictEqual(saved.ignoredDiagnostics, [
        {
          file: "questions/q/info.json",
          rule: "schema",
          message: "missing a property",
          occurrence: 1,
        },
        {
          file: "questions/q/info.json",
          rule: "schema",
          message: "missing a property",
          occurrence: 2,
        },
        {
          file: "questions/q/info.json",
          rule: "unused-question",
          identifier: "q",
        },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
      await measurePerformance("diagnostics-document-edit", 200, async () => {
        await editor.edit((e) =>
          e.insert(at, '{ "id": "deps", "points": 1 },\n        '),
        );
        assert.deepStrictEqual(await until(unused, (ds) => ds.length === 0), []);
      });
    } finally {
      await measurePerformance("diagnostics-document-revert", 200, async () => {
        await vscode.commands.executeCommand("workbench.action.files.revert");
        assert.strictEqual((await until(unused, (ds) => ds.length === 1)).length, 1);
      });
    }
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
      const infos = await measurePerformance("diagnostics-settings-change", 200, async () => {
        await settings.update(
          "diagnostics.client-files-course-exist",
          "info",
          vscode.ConfigurationTarget.Workspace,
        );
        return until(missing, (ds) =>
          ds.length === 2 &&
          ds.every((d) => d.severity === vscode.DiagnosticSeverity.Information),
        );
      });
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
      await measurePerformance("diagnostics-file-create", 200, async () => {
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(infoJson),
          Buffer.from('{ "uuid": "c7c9d1d6-3d3e-4f0e-9c55-1f0a6b4f1e11", "title": "t", "topic": "t", "type": "v3" }'),
        );
        assert.deepStrictEqual(await until(missing, (ds) => ds.length === 0), []);
      });
      // Let the question-file cache observe the creation before deleting the
      // file; otherwise native watchers may coalesce a very short-lived file.
      assert.deepStrictEqual(
        await waitForBulkQuestionIds("onlyServer", 1),
        ["onlyServer"],
      );
    } finally {
      await measurePerformance("diagnostics-file-delete", 200, async () => {
        await vscode.workspace.fs.delete(vscode.Uri.file(infoJson));
        assert.strictEqual((await until(missing, (ds) => ds.length === 1)).length, 1);
      });
    }
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
      const severities = await until(
        () => ourDiagnostics(depsInfo).map((d) => d.severity),
        (values) =>
          values.length > 0 &&
          values.every((severity) => severity === vscode.DiagnosticSeverity.Warning),
        "workspace settings diagnostics",
      );
      assert.deepStrictEqual(severities, [
        vscode.DiagnosticSeverity.Warning,
        vscode.DiagnosticSeverity.Warning,
      ]);
    } finally {
      await settings.update("rules", undefined, vscode.ConfigurationTarget.Workspace);
      fs.rmSync(path.join(course, ".vscode"), { recursive: true, force: true });
    }
  });

  test("500-file operations settle without stale diagnostics or cache entries", async function () {
    if (!process.env.PL_NAVIGATOR_VSCODE_TEST_FIXTURES) {
      this.skip(); // The npm wrapper supplies an isolated copy outside the repository.
    }
    this.timeout(15_000);
    const count = 500;
    const localPrefix = "perfBulk";
    const root = path.join(course, "questions", "perfBulk");
    const infoFile = path.join(root, "info.json");
    const assetRoot = path.join(root, "clientFilesQuestion");
    const assetFiles = Array.from({ length: count - 1 }, (_, i) =>
      path.join(assetRoot, `asset${String(i).padStart(4, "0")}.txt`),
    );
    const info = (changed: boolean) =>
      JSON.stringify({
        uuid: "00000000-0000-0000-0000-000000000500",
        title: "Bulk file watcher question",
        type: "v3",
        topic: "T",
        ...(changed ? { notAProperty: true } : {}),
      });

    fs.rmSync(root, { recursive: true, force: true });
    try {
      await measurePerformance("bulk-create-500-files", 1_000, async () => {
        await fs.promises.mkdir(assetRoot, { recursive: true });
        await runInBatches(assetFiles, 32, (file, i) =>
          fs.promises.writeFile(file, `created ${i}`),
        );
        await fs.promises.writeFile(infoFile, info(false));
        const diagnostics = await until(
          () => diagnosticsUnder(root),
          (entries) => entries.length === 1,
          "the question created with 499 assets to be diagnosed",
        );
        assert.strictEqual(diagnostics.length, 1);
        const ids = await waitForBulkQuestionIds(localPrefix, 1);
        assert.deepStrictEqual(ids, [localPrefix]);
      });

      await measurePerformance("bulk-change-500-files", 1_000, async () => {
        await fs.promises.writeFile(infoFile, info(true));
        await runInBatches(assetFiles, 32, (file, i) =>
          fs.promises.writeFile(file, `changed ${i}`),
        );
        const diagnostics = await until(
          () => diagnosticsUnder(root),
          (entries) =>
            entries.length === 1 &&
            entries.every(([, values]) =>
              values.some((diagnostic) =>
                diagnostic.message.includes('unknown property "notAProperty"'),
              ),
            ),
          "the question changed with 499 assets to be rediagnosed",
        );
        assert.strictEqual(diagnostics.length, 1);
        const ids = await waitForBulkQuestionIds(localPrefix, 1);
        assert.deepStrictEqual(ids, [localPrefix]);
      });

      await measurePerformance("bulk-delete-500-files", 1_000, async () => {
        // Drain asset removals before deleting info.json, whose diagnostics and
        // completion entry are the observable sentinel for this operation.
        await runInBatches(assetFiles, 32, (file) => fs.promises.unlink(file));
        await vscode.workspace.fs.delete(vscode.Uri.file(root), {
          recursive: true,
        });
        await until(
          () => diagnosticsUnder(root),
          (entries) => entries.length === 0,
          `${count} deleted files to be removed from diagnostics`,
        );
        assert.deepStrictEqual(
          await waitForBulkQuestionIds(localPrefix, 0),
          [],
        );
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
