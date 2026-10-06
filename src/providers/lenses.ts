import * as path from "path";
import * as vscode from "vscode";
import {
  AssessmentCache,
  CourseCache,
  CourseInstanceCache,
  QuestionCache,
} from "../filewatchers";

function getAssessmentCourseInstanceDisplayName(
  assessmentUri: vscode.Uri
): string {
  const pathParts = assessmentUri.fsPath.split(path.sep);
  const instanceIndex = pathParts.indexOf("courseInstances");
  const assessmentsIndex = pathParts.indexOf("assessments");
  return path.join(...pathParts.slice(instanceIndex + 1, assessmentsIndex));
}

function getQualifiedAssessmentDisplayName(assessmentUri: vscode.Uri): string {
  const pathParts = assessmentUri.fsPath.split(path.sep);
  const instanceIndex = pathParts.indexOf("courseInstances");
  const assessmentsIndex = pathParts.indexOf("assessments");
  return path.join(
    ...pathParts.slice(instanceIndex + 1, assessmentsIndex),
    ...pathParts.slice(assessmentsIndex + 1, -1)
  );
}

function pluralize(n: number, s: string) {
  return n + " " + s + (n === 1 ? "" : "s");
}

export class AssessmentQuestionIdCodeLensProvider
  implements vscode.CodeLensProvider
{
  constructor(
    private courseCache: CourseCache,
    private assessmentCache: AssessmentCache
  ) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const courseId = this.courseCache.getCourseIdFor(document.uri);

    const re = /"id"\s*:[\n\s]*"([^"]+)"/gm;
    let match;
    while ((match = re.exec(text))) {
      const questionId = { localId: match[1], courseId };
      const matchRange = new vscode.Range(
        document.positionAt(match.index),
        document.positionAt(match.index + match[0].length)
      );
      const questionPaths = QuestionCache.questionFilePathsFromId(questionId);
      if (!questionPaths) {
        lenses.push(
          new vscode.CodeLens(matchRange, {
            title: `!! Unknown Id !!`,
            command: "prairielearn-navigator.unknownId",
            arguments: [questionId.localId],
          })
        );
        continue;
      }

      const assessmentId = this.assessmentCache.getAssessmentIdFor(
        document.uri
      );
      if (assessmentId !== null) {
        const allUses =
          await this.assessmentCache.getQuestionUseLocations(questionId);
        const instanceUses = allUses.filter(
          (loc) =>
            assessmentId.instanceId ===
            this.assessmentCache.getAssessmentIdFor(loc.uri)?.instanceId
        );
        if (instanceUses.length - 1) {
          const instDispName = getAssessmentCourseInstanceDisplayName(
            document.uri
          );
          lenses.push(
            new vscode.CodeLens(matchRange, {
              title: `${pluralize(
                instanceUses.length - 1,
                "reuse"
              )} in ${instDispName}!`,
              command: "prairielearn-navigator.showOccurrences",
              arguments: [instanceUses], // todo, maybe add def occurrence here
            })
          );

          for (const loc of instanceUses) {
            if (loc.uri !== document.uri) {
              lenses.push(
                new vscode.CodeLens(matchRange, {
                  title: `(${getQualifiedAssessmentDisplayName(loc.uri)})`,
                  command: "prairielearn-navigator.openFile",
                  arguments: [loc.uri.fsPath, loc.range],
                })
              );
            }
          }
        }
      }

      // for (const [key, p] of Object.entries(questionPaths.strict())) {
      //   if (key !== "dir") {
      //     lenses.push(
      //       new vscode.CodeLens(matchRange, {
      //         title: `${path.basename(p)}`,
      //         command: "prairielearn-navigator.openFile",
      //         arguments: [p],
      //       })
      //     );
      //   }
      // }
    }

    return lenses;
  }
}

export class QuestionHeaderCodeLensProvider implements vscode.CodeLensProvider {
  constructor(
    private courseCache: CourseCache,
    private assessmentCache: AssessmentCache
  ) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    const questionId = this.courseCache.getQuestionIdFor(document.uri);
    const occurrences =
      await this.assessmentCache.getQuestionUseLocations(questionId);
    const firstLine = new vscode.Range(0, 0, 0, 0);

    lenses.push(
      new vscode.CodeLens(firstLine, {
        title: pluralize(occurrences.length, `reference`),
        command: "prairielearn-navigator.showOccurrences",
        arguments: [occurrences],
      })
    );

    if (occurrences.length < 5) {
      for (const loc of occurrences) {
        const title = getQualifiedAssessmentDisplayName(loc.uri);
        lenses.push(
          new vscode.CodeLens(firstLine, {
            title,
            command: "prairielearn-navigator.openFile",
            arguments: [loc.uri.fsPath, loc.range],
          })
        );
      }
    }

    return lenses;
  }
}

export class CourseHeaderCodeLensProvider implements vscode.CodeLensProvider {
  constructor(
    private readonly courseCache: CourseCache,
    private readonly courseInstanceCache: CourseInstanceCache
  ) {}

  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const lenses = [];
    const firstLine = new vscode.Range(0, 0, 0, 0);

    const courseId = this.courseCache.getCourseIdFor(document.uri);
    const instances = this.courseInstanceCache
      .getCourseInstancesFor(courseId)
      .map((iid) => CourseInstanceCache.getUriFrom(iid));

    lenses.push(
      new vscode.CodeLens(firstLine, {
        title:
          pluralize(instances.length, "instance") +
          (instances.length ? "" : "!"),
        command: "prairielearn-navigator.showOccurrences",
        arguments: [
          instances.map((uri) => new vscode.Location(uri, firstLine)),
        ],
      })
    );

    if (instances.length < 10) {
      for (const uri of instances) {
        const title =
          this.courseInstanceCache.getCourseInstanceIdFor(uri).localId;
        lenses.push(
          new vscode.CodeLens(firstLine, {
            title,
            command: "prairielearn-navigator.openFile",
            arguments: [uri.fsPath, firstLine],
          })
        );
      }
    }
    return lenses;
  }
}

export class CourseInstanceHeaderCodeLensProvider
  implements vscode.CodeLensProvider
{
  constructor(
    private readonly courseCache: CourseCache,
    private readonly courseInstanceCache: CourseInstanceCache,
    private readonly assessmentCache: AssessmentCache
  ) {}

  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const lenses = [];
    const firstLine = new vscode.Range(0, 0, 0, 0);

    const instanceId = this.courseInstanceCache.getCourseInstanceIdFor(
      document.uri
    );

    const courseJson = this.courseCache.getUriFrom(instanceId.courseId);
    if (courseJson) {
      lenses.push(
        new vscode.CodeLens(firstLine, {
          title: `${
            this.courseCache.getDisplayNameFor(instanceId.courseId) ??
            "infoCourse"
          }.json`,
          command: "prairielearn-navigator.openFile",
          arguments: [courseJson.fsPath, firstLine],
        })
      );
    }

    const assessments = this.assessmentCache
      .getAssessmentsFor(instanceId)
      .map((aid) => AssessmentCache.getUriFrom(aid));

    lenses.push(
      new vscode.CodeLens(firstLine, {
        title:
          pluralize(assessments.length, "assessment") +
          (assessments.length ? "" : "!"),
        command: "prairielearn-navigator.showOccurrences",
        arguments: [
          assessments.map((uri) => new vscode.Location(uri, firstLine)),
        ],
      })
    );

    if (assessments.length < 6) {
      for (const uri of assessments) {
        const title =
          this.assessmentCache.getAssessmentIdFor(uri)?.assessmentId ??
          this.courseCache.getScopedIdFor(uri).localId;
        lenses.push(
          new vscode.CodeLens(firstLine, {
            title,
            command: "prairielearn-navigator.openFile",
            arguments: [uri.fsPath, firstLine],
          })
        );
      }
    }
    return lenses;
  }
}
