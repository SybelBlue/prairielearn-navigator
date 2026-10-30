import * as vscode from "vscode";

export const productionDebounceMs = 300;
export const testDebounceMs = 10;

/** Keep production settling behavior while letting extension-host tests run promptly. */
export function debounceMsForExtensionMode(mode: vscode.ExtensionMode): number {
  return mode === vscode.ExtensionMode.Test
    ? testDebounceMs
    : productionDebounceMs;
}
