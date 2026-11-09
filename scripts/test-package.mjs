import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webpack from "webpack";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), "prairielearn-navigator-package-"),
);

try {
  const npmEnvironment = {
    ...process.env,
    npm_config_cache: path.join(temporary, "npm-cache"),
  };
  const packed = execFileSync(
    "npm",
    ["pack", "--silent", "--pack-destination", temporary],
    {
      cwd: path.join(root, "packages", "cli"),
      encoding: "utf8",
      env: npmEnvironment,
    },
  ).trim();
  const tarball = path.join(temporary, packed.split("\n").at(-1));
  const consumer = path.join(temporary, "consumer");
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({
      type: "module",
    }),
  );
  const installed = path.join(
    consumer,
    "node_modules",
    "@sybelblue",
    "prairielearn-navigator",
  );
  fs.mkdirSync(installed, { recursive: true });
  execFileSync(
    "tar",
    ["-xzf", tarball, "-C", installed, "--strip-components", "1"],
    { stdio: "inherit" },
  );

  const distFiles = fs
    .readdirSync(path.join(installed, "dist"), { recursive: true })
    .filter((entry) =>
      fs.statSync(path.join(installed, "dist", entry)).isFile(),
    )
    .map((entry) => String(entry).split(path.sep).join("/"))
    .sort();
  const expectedDistFiles = [
    "cli.js",
    "core/additions.d.ts",
    "core/assessmentQuestionRefs.d.ts",
    "core/assessments.d.ts",
    "core/course.d.ts",
    "core/fileEdits.d.ts",
    "core/json.d.ts",
    "core/jsonEdits.d.ts",
    "core/plVersion.d.ts",
    "core/questionFileResolver.d.ts",
    "core/referenceIndex.d.ts",
    "core/references/bases.d.ts",
    "core/references/extract.d.ts",
    "core/references/specs.d.ts",
    "core/removals.d.ts",
    "core/tags.d.ts",
    "core/templates.d.ts",
    "index.js",
    "library.d.ts",
    "shared.js",
  ];
  if (JSON.stringify(distFiles) !== JSON.stringify(expectedDistFiles)) {
    throw new Error(
      `unexpected packed dist files: ${JSON.stringify(distFiles)}`,
    );
  }

  const cli = path.join(installed, "dist", "cli.js");
  if (!fs.readFileSync(cli, "utf8").startsWith("#!/usr/bin/env node\n")) {
    throw new Error("packed CLI is missing its executable shebang");
  }
  // npm creates an executable bin link on install. The tar entry itself is
  // not executable, so set that bit here to exercise the shebang as well as
  // checking the package's bin mapping below.
  fs.chmodSync(cli, 0o755);
  const cliHelp = execFileSync(cli, ["--help"], {
    encoding: "utf8",
  });
  if (!cliHelp.startsWith("Usage: prairielearn-navigator")) {
    throw new Error(`unexpected CLI help output: ${cliHelp}`);
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(installed, "package.json"), "utf8"),
  );
  if (manifest.bin?.["prairielearn-navigator"] !== "dist/cli.js") {
    throw new Error("packed CLI bin mapping is incorrect");
  }
  const cliVersion = execFileSync(cli, ["--version"], {
    encoding: "utf8",
  }).trim();
  if (cliVersion !== manifest.version) {
    throw new Error(`unexpected CLI version output: ${cliVersion}`);
  }

  // Declarations must resolve on their own: no undeclared packages, no
  // unpublished files, and ".js" on relative specifiers for NodeNext.
  for (const file of distFiles.filter((f) => f.endsWith(".d.ts"))) {
    const text = fs.readFileSync(path.join(installed, "dist", file), "utf8");
    for (const [, specifier] of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      if (!specifier.startsWith(".") || !specifier.endsWith(".js")) {
        throw new Error(`${file} imports "${specifier}"`);
      }
      const target = path.posix.join(path.posix.dirname(file), specifier.replace(/\.js$/, ".d.ts"));
      if (!distFiles.includes(target)) {
        throw new Error(`${file} imports unpublished "${specifier}"`);
      }
    }
  }

  // Every runtime export, imported and exercised from plain Node ESM.
  fs.mkdirSync(path.join(consumer, "course", "questions"), { recursive: true });
  fs.writeFileSync(
    path.join(consumer, "course", "infoCourse.json"),
    '{"tags": [{"name": "old", "color": "red1", "description": "old"}]}',
  );
  fs.writeFileSync(
    path.join(consumer, "consumer.mjs"),
    `import * as library from "@sybelblue/prairielearn-navigator";
import {
  addNouns,
  appendJsonEdits,
  assessmentId,
  assessmentQuestionRefs,
  collectAddValues,
  courseAssessments,
  courseInstances,
  courseTags,
  createQuestionFileResolver,
  defaultTopic,
  findCourseRoot,
  implicitTagColor,
  indexCourse,
  jsonValueRange,
  newQuestionTitle,
  parseJsonDoc,
  planAssessmentRename,
  plBadgeColors,
  plDefaultTag,
  plDefaultTagList,
  prepareFileChanges,
  questionInfo,
  removedFileSuppressionPlan,
  removeNouns,
  resolveAddValues,
  stepBack,
  strictJsonErrors,
  today,
} from "@sybelblue/prairielearn-navigator";
import * as fs from "node:fs";
import * as path from "node:path";

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
// webpack's ES module output also exports its runtime from each entry chunk.
const names = Object.keys(library)
  .filter((name) => name !== "__webpack_require__")
  .sort()
  .join(",");
check(
  names ===
    "addNouns,appendJsonEdits,assessmentId,assessmentQuestionRefs,collectAddValues,courseAssessments," +
      "courseInstances,courseTags,createQuestionFileResolver,defaultTopic,findCourseRoot,implicitTagColor," +
      "indexCourse,jsonValueRange,newQuestionTitle,parseJsonDoc,plBadgeColors,plDefaultTag,plDefaultTagList," +
      "planAssessmentRename,prepareFileChanges,questionInfo,removeNouns,removedFileSuppressionPlan," +
      "resolveAddValues,stepBack,strictJsonErrors,today",
  "unexpected exports: " + names,
);
check(typeof createQuestionFileResolver === "function", "createQuestionFileResolver");

const course = path.resolve("course");
check(findCourseRoot(path.join(course, "questions", "infoCourse.json")) === course, "findCourseRoot");

const doc = parseJsonDoc('{"tags": [{"name": "t", "color": "red1"}], /* c */}');
check(doc.errors.length === 0, "parseJsonDoc");
check(strictJsonErrors('{"a": 1, /* c */}').length > 0, "strictJsonErrors");
const tags = courseTags(doc);
check(tags.length === 1 && tags[0].name === "t" && tags[0].color === "red1", "courseTags");

check(Object.isFrozen(plBadgeColors) && Object.isFrozen(plBadgeColors.red1), "plBadgeColors frozen");
check(plBadgeColors[implicitTagColor].text === "#656565", "implicitTagColor");
check(plDefaultTag("numeric")?.color === "brown1", "plDefaultTag");
check(plDefaultTagList().some((tag) => tag.name === "numeric"), "plDefaultTagList");

const refs = assessmentQuestionRefs(
  '{"zones": [{"questions": [{"id": "a"}, {"alternatives": [{"id": "b"}]}]}]}',
);
check(
  JSON.stringify(refs.map((r) => [r.kind, r.id])) === '[["question","a"],["alternative","b"]]',
  "assessmentQuestionRefs",
);

const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};
const index = indexCourse(course, today());
const addContext = { index, courseInstances: courseInstances(course), readText };
const infoCourse = path.join(course, "infoCourse.json");

const addedValues = resolveAddValues(addNouns.tag, addContext, { name: "t" });
const addedTag = addNouns.tag.plan(addContext, addedValues, "unused");
check(addedTag.kind === "edits", "addNouns.tag.plan");
check(prepareFileChanges(addedTag.edits)[0].updated.includes('"t"'), "prepareFileChanges");
const question = addNouns.qid.plan(
  addContext,
  resolveAddValues(addNouns.qid, addContext, { qid: "a/b" }),
  "11111111-1111-4111-8111-111111111111",
);
check(question.kind === "files" && question.created[0].file.endsWith("info.json"), "addNouns.qid.plan");
const asked = [];
const collected = await collectAddValues(addNouns.tag, addContext, async (step) => {
  asked.push(step.field.key);
  return asked.length === 2 && asked[0] === "name" && !asked.includes("back")
    ? (asked.push("back"), stepBack)
    : (step.value ?? "t");
});
check(collected?.name === "t" && asked.includes("back"), "collectAddValues and stepBack");

check(JSON.stringify(removeNouns.tag.targets(addContext)) === '["old"]', "removeNouns targets");
const removal = removeNouns.tag.plan(addContext, "old", { updateReferences: true });
check(removal.primaryEdits.length > 0, "removeNouns plan");
check(removedFileSuppressionPlan(addContext, [course]).useCount === 0, "removedFileSuppressionPlan");

check(courseInstances(course).length === 0 && courseAssessments(index).length === 0, "assessment listing");
check(assessmentId({ file: "f", instance: "Fa26", assessment: "hw1" }) === "Fa26/hw1", "assessmentId");
let renameError = "";
try {
  planAssessmentRename(index, "Fa26/hw1", "Fa26/hw2", readText);
} catch (error) {
  renameError = error.message;
}
check(renameError === 'Assessment "Fa26/hw1" is not defined', "planAssessmentRename");

check(appendJsonEdits("infoCourse.json", "{}", "topics", { name: "x" }).length > 0, "appendJsonEdits");
check(jsonValueRange('{"a": "bc"}', ["a"])?.start === 7, "jsonValueRange");
check(defaultTopic('{"topics": [{"name": "Algebra"}]}') === "Algebra", "defaultTopic");
check(JSON.parse(questionInfo("u", newQuestionTitle, "T")).title === "New Question", "questionInfo");
check(fs.existsSync(infoCourse), "course fixture");
console.log("library-ok");
`,
  );

  // Every public type, checked against the shipped declarations.
  fs.writeFileSync(
    path.join(consumer, "consumer.ts"),
    `import {
  addNouns,
  assessmentQuestionRefs,
  collectAddValues,
  courseAssessments,
  courseInstances,
  courseTags,
  createQuestionFileResolver,
  findCourseRoot,
  implicitTagColor,
  indexCourse,
  jsonValueRange,
  parseJsonDoc,
  planAssessmentRename,
  plBadgeColors,
  plDefaultTag,
  plDefaultTagList,
  prepareFileChanges,
  removeNouns,
  resolveAddValues,
  stepBack,
  strictJsonErrors,
  today,
  type AddContext,
  type AddField,
  type AddNoun,
  type AddPrompt,
  type AddStep,
  type AddValues,
  type AssessmentQuestionRef,
  type AssessmentRename,
  type CourseAddition,
  type CourseAssessment,
  type CourseRemoval,
  type CourseTag,
  type FileChange,
  type FileEdit,
  type IsoDate,
  type JsonDoc,
  type JsonFocus,
  type JsonPath,
  type NewFile,
  type QuestionFileResolver,
  type ReferenceIndex,
  type RemoveContext,
  type RemoveNoun,
  type RemoveOptions,
  type TagInfo,
  type Use,
  type UsedNames,
} from "@sybelblue/prairielearn-navigator";

const cache = new Map<string, string | null>();
const root: string | null = findCourseRoot("/course/infoCourse.json", cache);
const doc: JsonDoc = parseJsonDoc("{}");
const errors: { offset: number; length: number; message: string }[] = [
  ...doc.errors,
  ...strictJsonErrors("{}"),
];
const tags: CourseTag[] = courseTags(doc);
const tag: TagInfo | undefined = plDefaultTag(tags[0]?.name ?? "numeric");
const defaults: readonly TagInfo[] = plDefaultTagList();
const color: { readonly text: string; readonly background: string } | undefined =
  plBadgeColors[tag?.color ?? implicitTagColor];
const refs: AssessmentQuestionRef[] = assessmentQuestionRefs("{}");
const kind: "question" | "alternative" | undefined = refs[0]?.kind;
const offsets: number | undefined = refs[0] && refs[0].endOffset - refs[0].startOffset;
const resolver: QuestionFileResolver = createQuestionFileResolver({
  courseRoot: root ?? "/course",
  questions: [],
});

const date: IsoDate = today();
const index: ReferenceIndex = indexCourse("/course", date);
const uses: Use[] = index.usesOf("/course/questions/a");
const names: UsedNames | undefined = index.namesIn("/course/infoCourse.json");
const readText = (_file: string): string | undefined => undefined;
const addContext: AddContext = { index, courseInstances: courseInstances("/course"), readText };
const removeContext: RemoveContext = { index, readText };
const addNoun: AddNoun = addNouns.qid;
const firstField: AddField = addNoun.fields[0];
const given: AddValues = { qid: "a/b" };
const values: AddValues = resolveAddValues(addNoun, addContext, given);
const addition: CourseAddition = addNoun.plan(addContext, values, "uuid");
const focus: JsonFocus = addition.focus;
const focusPath: JsonPath = focus.path;
const created: NewFile[] = addition.kind === "files" ? addition.created : [];
const edits: FileEdit[] = addition.kind === "edits" ? addition.edits : [];
const changes: FileChange[] = prepareFileChanges(edits);
const prompt: AddPrompt = async (step: AddStep) => (step.index > 0 ? stepBack : step.value);
const collected: Promise<AddValues | undefined> = collectAddValues(addNoun, addContext, prompt);
const removeNoun: RemoveNoun = removeNouns["assessment-set"];
const options: RemoveOptions = { updateReferences: true, replacement: "Homework" };
const removal: CourseRemoval = removeNoun.plan(removeContext, "Lab", options);
const assessments: CourseAssessment[] = courseAssessments(index);
const rename: AssessmentRename = planAssessmentRename(index, "a/b", "a/c", readText);
const range: { start: number; end: number } | undefined = jsonValueRange("{}", focusPath);

// @ts-expect-error unknown nouns aren't addable
addNouns.widget;
// @ts-expect-error jsonc-parser's nodes stay out of the public API
import("@sybelblue/prairielearn-navigator").then((m) => m.removeJsonValues);
// @ts-expect-error plBadgeColors is read-only
plBadgeColors.red1 = { text: "#000000", background: "#ffffff" };
// @ts-expect-error badge color entries are read-only
plBadgeColors.red1.text = "#000000";
// @ts-expect-error JsonDoc.tree is opaque
doc.tree?.children;
// @ts-expect-error a JsonDoc can't be made up
courseTags({ value: {}, tree: {}, errors: [] });
// @ts-expect-error assessmentQuestionRefs takes text
assessmentQuestionRefs({});

export {
  assessments,
  changes,
  collected,
  color,
  created,
  defaults,
  errors,
  firstField,
  kind,
  names,
  offsets,
  range,
  removal,
  rename,
  resolver,
  uses,
};
`,
  );
  const typeCheck = (moduleResolution, module) =>
    fs.writeFileSync(
      path.join(consumer, `tsconfig.${moduleResolution}.json`),
      JSON.stringify({
        compilerOptions: {
          module,
          moduleResolution,
          target: "ES2022",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        include: ["consumer.ts"],
      }),
    );
  typeCheck("NodeNext", "NodeNext");
  typeCheck("Bundler", "ESNext");

  const library = ["index.js", "shared.js"]
    .map((file) => fs.readFileSync(path.join(installed, "dist", file), "utf8"))
    .join("\n");
  if (/from\s+["']vscode["']|require\(["']vscode["']\)/.test(library)) {
    throw new Error("packed library imports vscode");
  }

  const output = execFileSync(process.execPath, ["consumer.mjs"], {
    cwd: consumer,
    encoding: "utf8",
  }).trim();
  if (output !== "library-ok") {
    throw new Error(`unexpected import output: ${output}`);
  }
  for (const moduleResolution of ["NodeNext", "Bundler"]) {
    execFileSync(
      path.join(root, "node_modules", ".bin", "tsc"),
      ["-p", path.join(consumer, `tsconfig.${moduleResolution}.json`)],
      { stdio: "inherit" },
    );
  }

  await new Promise((resolve, reject) => {
    webpack(
      {
        context: consumer,
        entry: "./consumer.mjs",
        target: "node22",
        mode: "production",
        experiments: { outputModule: true },
        output: {
          path: path.join(consumer, "bundle"),
          filename: "consumer.mjs",
          module: true,
        },
      },
      (error, stats) => {
        if (error) return reject(error);
        if (stats?.hasErrors()) {
          return reject(new Error(stats.toString({ colors: false })));
        }
        resolve();
      },
    );
  });
  const bundled = execFileSync(
    process.execPath,
    [path.join("bundle", "consumer.mjs")],
    { cwd: consumer, encoding: "utf8" },
  ).trim();
  if (bundled !== "library-ok") {
    throw new Error(`unexpected bundle output: ${bundled}`);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
