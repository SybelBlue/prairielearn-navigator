import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const course = path.resolve(__dirname, "../../src/test-cli/fixtures/broken");
const depsInfo = vscode.Uri.file(path.join(course, "questions/deps/info.json"));
const assessment = vscode.Uri.file(
  path.join(course, "courseInstances/Fa26/assessments/hw1/infoAssessment.json")
);

async function diagnosticsFor(uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
  for (let i = 0; i < 100; i++) {
    const ds = vscode.languages.getDiagnostics(uri);
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
        severities = vscode.languages.getDiagnostics(depsInfo).map((d) => d.severity);
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
