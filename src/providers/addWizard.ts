import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  AddContext,
  addNouns,
  AddNoun,
  AddPrompt,
  AddStep,
  collectAddValues,
  CourseAddition,
  stepBack,
} from "../core/additions";
import { courseInstances } from "../core/assessments";
import { courseFiles } from "../core/courseFiles";
import { CourseCache, ReferenceIndexCache } from "../filewatchers";
import { addFileEdits, applyToDocument, currentText, revealFocus } from "./fileEdits";
import { generateUuid } from "./uuid";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `step.problem`, for callbacks that have nowhere to throw to. */
function problemWith(step: AddStep, value: string): string | undefined {
  try {
    return step.problem(value);
  } catch (error) {
    return errorMessage(error);
  }
}

type StepAnswer = string | typeof stepBack | undefined;

/** Runs one quick input, resolving with the first answer it reports. */
function quickInput<T extends vscode.InputBox | vscode.QuickPick<vscode.QuickPickItem>>(
  title: string,
  step: AddStep,
  input: T,
  listen: (finish: (answer: StepAnswer) => void) => vscode.Disposable[]
): Promise<StepAnswer> {
  input.title = title;
  input.step = step.index + 1;
  input.totalSteps = step.total;
  input.ignoreFocusOut = true;
  input.buttons = step.index > 0 ? [vscode.QuickInputButtons.Back] : [];
  return new Promise((resolve) => {
    const finish = (answer: StepAnswer) => {
      disposables.forEach((d) => d.dispose());
      input.dispose();
      resolve(answer);
    };
    const disposables = [
      ...listen(finish),
      input.onDidTriggerButton(() => finish(stepBack)),
      input.onDidHide(() => finish(undefined)),
    ];
    input.show();
  });
}

function inputStep(title: string, step: AddStep): Promise<StepAnswer> {
  const input = vscode.window.createInputBox();
  input.prompt = step.field.usage;
  input.value = step.value ?? "";
  if (step.index === 0) {
    // An id starts as a folder, to continue rather than replace
    input.valueSelection = [input.value.length, input.value.length];
  }
  return quickInput(title, step, input, (finish) => [
    input.onDidChangeValue((value) => {
      input.validationMessage = problemWith(step, value);
    }),
    input.onDidAccept(() => {
      input.validationMessage = problemWith(step, input.value);
      if (!input.validationMessage) {
        finish(input.value);
      }
    }),
  ]);
}

function pickStep(title: string, step: AddStep): Promise<StepAnswer> {
  const pick = vscode.window.createQuickPick();
  const labels = [...(step.choices ?? [])];
  if (step.value !== undefined && !labels.includes(step.value)) {
    labels.unshift(step.value);
  }
  const choices = labels.map((label) => ({ label }));
  pick.placeholder = step.field.usage;
  pick.items = choices;
  pick.activeItems = choices.filter((item) => item.label === step.value);
  return quickInput(title, step, pick, (finish) => [
    pick.onDidChangeValue((value) => {
      if (step.field.allowCustom) {
        pick.items = value && !labels.includes(value) ? [{ label: value }, ...choices] : choices;
      }
    }),
    pick.onDidAccept(() => {
      const label = pick.activeItems[0]?.label;
      const problem = label === undefined ? step.field.usage : problemWith(step, label);
      if (problem) {
        pick.placeholder = problem;
      } else {
        finish(label);
      }
    }),
  ]);
}

/** The prompt for a noun: a pick for a field with choices, else an input box. */
function vscodePrompt(noun: AddNoun): AddPrompt {
  const title = `Add ${noun.noun[0].toUpperCase()}${noun.noun.slice(1)}`;
  return (step) => (step.choices ? pickStep(title, step) : inputStep(title, step));
}

/** The URI to find a course from: a clicked resource, else the active editor. */
function startingPoint(target: vscode.Uri | undefined): { probe?: vscode.Uri; dir?: string } {
  if (!target) {
    const active = vscode.window.activeTextEditor?.document.uri;
    return { probe: active, dir: active && path.dirname(active.fsPath) };
  }
  // Course lookup takes the parent of what it's given, so go one level down
  return fs.statSync(target.fsPath, { throwIfNoEntry: false })?.isDirectory()
    ? { probe: vscode.Uri.joinPath(target, "_"), dir: target.fsPath }
    : { probe: target, dir: path.dirname(target.fsPath) };
}

async function chooseCourse(courses: readonly string[]): Promise<string | undefined> {
  return courses.length > 1
    ? vscode.window.showQuickPick([...courses], { title: "Choose a Course" })
    : courses[0];
}

async function applyAddition(addition: CourseAddition): Promise<boolean> {
  const workspaceEdit = new vscode.WorkspaceEdit();
  if (addition.kind === "edits") {
    addFileEdits(workspaceEdit, addition.edits);
    const document = await vscode.workspace.openTextDocument(addition.focus.file);
    return applyToDocument(workspaceEdit, document);
  }
  for (const { file, contents } of addition.created) {
    workspaceEdit.createFile(vscode.Uri.file(file), { contents: new TextEncoder().encode(contents) });
  }
  return vscode.workspace.applyEdit(workspaceEdit);
}

export interface AddCommandOptions {
  /** Answers each step in place of VS Code's quick input. */
  prompt?: AddPrompt;
}

/**
 * The command adding a `noun` to the course around `target`, an Explorer
 * resource: asks for its values, applies the plan, and shows the result.
 * Resolves to whether it added one.
 */
export function addCommand(
  noun: AddNoun,
  courseCache: Pick<CourseCache, "getCourseIdFor" | "getCourseIds">,
  references: Pick<ReferenceIndexCache, "whenIndexed">,
  options: AddCommandOptions = {}
) {
  return async (target?: vscode.Uri): Promise<boolean> => {
    try {
      const { probe, dir } = startingPoint(target);
      const courseRoot = (probe && courseCache.getCourseIdFor(probe)) ||
        await chooseCourse(courseCache.getCourseIds());
      if (!courseRoot) {
        void vscode.window.showErrorMessage("PrairieLearn Navigator: no course found.");
        return false;
      }
      const infoCourse = vscode.Uri.file(path.join(courseRoot, courseFiles.course));
      const index = await references.whenIndexed(infoCourse);
      if (!index) {
        throw new Error(`Could not index the course at ${courseRoot}`);
      }

      const ctx: AddContext = {
        index,
        courseInstances: courseInstances(courseRoot),
        readText: currentText,
      };
      const seed = { [noun.fields[0].key]: noun.idPrefix?.(ctx, dir ?? courseRoot) ?? "" };
      const values = await collectAddValues(noun, ctx, options.prompt ?? vscodePrompt(noun), seed);
      if (!values) {
        return false;
      }
      const uuid = noun.needsUuid ? await generateUuid(infoCourse) : "";
      const addition = noun.plan(ctx, values, uuid);
      if (!(await applyAddition(addition))) {
        return false;
      }
      addition.warnings.forEach((warning) => {
        void vscode.window.showWarningMessage(`PrairieLearn Navigator: ${warning}.`);
      });
      await revealFocus(addition.focus);
      return true;
    } catch (error) {
      void vscode.window.showErrorMessage(`PrairieLearn Navigator: ${errorMessage(error)}.`);
      return false;
    }
  };
}

/** Every add command, by name. */
export function addCommands(
  courseCache: Pick<CourseCache, "getCourseIdFor" | "getCourseIds">,
  references: Pick<ReferenceIndexCache, "whenIndexed">
) {
  const command = (noun: AddNoun) => addCommand(noun, courseCache, references);
  return {
    addQuestion: command(addNouns.qid),
    addTag: command(addNouns.tag),
    addAssessmentSet: command(addNouns["assessment-set"]),
    addAssessment: command(addNouns.assessment),
  };
}
