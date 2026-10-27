import { exec } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";

const configurationSection = "prairielearn-navigator";
const defaultUuidCommand = "uuidgen";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Generates and validates a UUID using the command configured for a document. */
export function generateUuid(document: vscode.TextDocument): Promise<string> {
  const settings = vscode.workspace.getConfiguration(
    configurationSection,
    document.uri,
  );
  const command = settings.get<string>("uuidCommand", defaultUuidCommand);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const cwd = workspaceFolder?.uri.fsPath ?? path.dirname(document.uri.fsPath);

  return new Promise((resolve, reject) => {
    exec(command, { cwd, timeout: 10_000 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      const uuid = stdout.trim();
      if (!uuidPattern.test(uuid)) {
        reject(
          new Error(
            `command returned an invalid UUID: ${JSON.stringify(uuid)}`,
          ),
        );
        return;
      }
      resolve(uuid);
    });
  });
}

export function reportUuidGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(
    `PrairieLearn Navigator: UUID command failed: ${message}`,
  );
}
