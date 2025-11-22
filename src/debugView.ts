import * as vscode from "vscode";
import * as YAML from "json-to-pretty-yaml";
import { CourseId, LocalId, LocalIdUsage } from "./utils";
import {
  AssessmentCache,
  CourseCache,
  CourseInstanceCache,
  QuestionCache,
} from "./filewatchers";

type AssessmentData = LocalIdUsage[];
type InstanceData = Map<LocalId, AssessmentData>;
type CourseData = {
  instances: Map<LocalId, InstanceData>;
  questions: Set<LocalId>;
};

type JsonRegistry = Map<CourseId, CourseData>;

export class DebugView {
  constructor(
    private courseCache: CourseCache,
    private courseInstanceCache: CourseInstanceCache,
    private assessmentCache: AssessmentCache,
    private questionCache: QuestionCache
  ) {
    const onUpdate = () => {
      const data = this.rebuild();
      console.log(this.registryToDebugYaml(data));
    };
    courseCache.onUpdated(() => onUpdate());
    courseInstanceCache.onUpdated(() => onUpdate());
    assessmentCache.onUpdated(() => onUpdate());
    questionCache.onUpdated(() => onUpdate());
  }

  private registryToDebugObject(data: JsonRegistry) {
    return Object.fromEntries(
      [...data.entries()].map(([courseId, v]) => [
        this.courseCache.getDisplayNameFor(courseId) || ".",
        {
          questions: [...v.questions],
          instances: Object.fromEntries(
            [...v.instances.entries()].map(([instanceId, v]) => [
              instanceId,
              Object.fromEntries(
                [...v.entries()].map(([assessmentId, v]) => [
                  assessmentId,
                  v.map(({ localId, location }) => ({
                    localId,
                    at: `${location.range.start.line}:${location.range.start.character} -> ${location.range.end.line}:${location.range.end.character}`,
                  })),
                ])
              ),
            ])
          ),
        },
      ])
    );
  }

  private registryToDebugJson(data: JsonRegistry) {
    return JSON.stringify(this.registryToDebugObject(data), undefined, 2);
  }

  private registryToDebugYaml(data: JsonRegistry) {
    return YAML.stringify(this.registryToDebugObject(data));
  }

  private rebuild(): JsonRegistry {
    const out: JsonRegistry = new Map();

    for (const courseId of this.courseCache.getCourseIds()) {
      const instances: Map<LocalId, InstanceData> = new Map();
      for (const instanceId of this.courseInstanceCache.getCourseInstancesFor(
        courseId
      )) {
        const assessmentData: Map<LocalId, AssessmentData> = new Map();
        for (const assessmentId of this.assessmentCache.getAssessmentsFor(
          instanceId
        )) {
          assessmentData.set(
            assessmentId.assessmentId,
            this.assessmentCache.getQuestionUsesFor(assessmentId)
          );
        }
        instances.set(instanceId.localId, assessmentData);
      }

      const questions: Set<LocalId> = new Set();
      for (const questionId of this.questionCache.getQuestionIds()) {
        if (questionId.courseId === courseId) {
          questions.add(questionId.localId);
        }
      }
      out.set(courseId, { instances, questions });
    }

    return out;
  }
}
