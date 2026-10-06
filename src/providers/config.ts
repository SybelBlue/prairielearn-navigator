import * as path from "path";
import * as vscode from "vscode";
import {
  configFileName,
  ConfigOverrides,
  LoadedConfig,
  loadConfig,
  NavigatorConfig,
} from "../core/config";
import { SchemaStore } from "../core/schemas";

const section = "prairielearn-navigator";
const keys = ["plVersion", "schemaCacheDir", "rules", "excludes"] as const;

/**
 * Resolves each course's NavigatorConfig from VS Code settings and the
 * course's .pl-navigator.jsonc, so the editor and the CLI agree.
 *
 * Precedence: workspace / folder settings (.vscode/settings.json), then
 * .pl-navigator.jsonc, then user settings, then built-in defaults; except
 * `excludes`, which all of them add to. Relative paths in settings are
 * relative to the workspace folder.
 */
export class ConfigProvider {
  private configs = new Map<string, LoadedConfig>();
  private stores = new Map<string, SchemaStore>();
  private reportedProblems = new Set<string>();
  private onChangedEmitter = new vscode.EventEmitter<void>();
  private disposables: vscode.Disposable[] = [];

  /** Fires when settings, a config file, or the schema cache change. */
  public readonly onChanged = this.onChangedEmitter.event;

  constructor(private context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${configFileName}`);
    const invalidate = () => this.reset(false);
    this.disposables.push(
      watcher,
      watcher.onDidCreate(invalidate),
      watcher.onDidChange(invalidate),
      watcher.onDidDelete(invalidate),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(section)) {
          this.reset(false);
        }
      })
    );
  }

  /** Forgets cached configs; with `schemas`, also retries schema downloads. */
  reset(schemas: boolean) {
    this.configs.clear();
    if (schemas) {
      this.stores.clear();
      this.reportedProblems.clear();
    }
    this.onChangedEmitter.fire();
  }

  configFor(courseRoot: string): NavigatorConfig {
    let loaded = this.configs.get(courseRoot);
    if (!loaded) {
      loaded = this.load(courseRoot);
      this.configs.set(courseRoot, loaded);
      for (const p of loaded.problems) {
        const where = p.file ? `${p.file}: ` : "settings: ";
        this.reportOnce(`${where}${p.message}`);
      }
    }
    return loaded.config;
  }

  schemasFor(config: NavigatorConfig): SchemaStore {
    let store = this.stores.get(config.schemaCacheDir);
    if (!store) {
      store = new SchemaStore({
        cacheDir: config.schemaCacheDir,
        githubToken: process.env.GITHUB_TOKEN,
      });
      this.stores.set(config.schemaCacheDir, store);
    }
    return store;
  }

  /** Shows schema download problems that have not been shown yet. */
  reportSchemaProblems(store: SchemaStore) {
    store.problems.forEach((p) => this.reportOnce(p));
  }

  private reportOnce(message: string) {
    if (!this.reportedProblems.has(message)) {
      this.reportedProblems.add(message);
      vscode.window.showWarningMessage(`PrairieLearn Navigator: ${message}`);
    }
  }

  private load(courseRoot: string): LoadedConfig {
    const uri = vscode.Uri.file(courseRoot);
    const settings = vscode.workspace.getConfiguration(section, uri);
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const baseDir = folder?.uri.fsPath ?? courseRoot;

    const overrides: ConfigOverrides = {};
    const userDefaults: ConfigOverrides = {};
    for (const key of keys) {
      const inspected = settings.inspect(key);
      const workspaceValue = inspected?.workspaceFolderValue ?? inspected?.workspaceValue;
      if (workspaceValue !== undefined) {
        overrides[key] = workspaceValue;
      } else if (inspected?.globalValue !== undefined) {
        userDefaults[key] = inspected.globalValue;
      }
    }
    for (const values of [overrides, userDefaults]) {
      if (typeof values.schemaCacheDir === "string" && values.schemaCacheDir !== "") {
        values.schemaCacheDir = path.resolve(baseDir, values.schemaCacheDir);
      } else {
        delete values.schemaCacheDir;
      }
    }

    // User settings sit beneath the config file, so apply them as validated defaults
    const defaults = loadConfig(null, {
      overrides: userDefaults,
      overridesBaseDir: baseDir,
      defaults: {
        schemaCacheDir: path.join(this.context.globalStorageUri.fsPath, "schemas"),
      },
    });
    const loaded = loadConfig(courseRoot, {
      overrides,
      overridesBaseDir: baseDir,
      defaults: defaults.config,
    });
    return { ...loaded, problems: [...defaults.problems, ...loaded.problems] };
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.onChangedEmitter.dispose();
  }
}
