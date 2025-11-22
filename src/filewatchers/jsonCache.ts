import { CourseId, LocalId, LocalIdUsage } from "../utils";
import {
  AssessmentCache,
  CourseCache,
  CourseInstanceCache,
  QuestionCache,
} from "./index";

type AssessmentData = Map<LocalId, LocalIdUsage[]>;
type InstanceData = Map<LocalId, AssessmentData[]>;
type CourseData = {
  instances: Map<LocalId, InstanceData>;
  questions: Set<LocalId>;
};

type JsonRegistry = Map<CourseId, CourseData>;

export class JsonCache {
  constructor(
    private courseCache: CourseCache,
    private courseInstanceCache: CourseInstanceCache,
    private assessmentCache: AssessmentCache,
    private questionCache: QuestionCache
  ) {
    courseCache.onUpdated(() => console.debug(this.rebuild()));
    courseInstanceCache.onUpdated(() => console.debug(this.rebuild()));
    assessmentCache.onUpdated(() => console.debug(this.rebuild()));
    questionCache.onUpdated(() => console.debug(this.rebuild()));
  }

  private rebuild(): JsonRegistry {
    const out: JsonRegistry = new Map();

    for (const courseId of this.courseCache.getCourseIds()) {
      const instances = new Map();
      for (const instanceId of this.courseInstanceCache.getCourseInstancesFor(
        courseId
      )) {
        const assessmentData = new Map();
        for (const assessmentId of this.assessmentCache.getAssessmentsFor(
          instanceId
        )) {
          const references = [];
          for (const use of this.assessmentCache.getQuestionUsesFor(
            assessmentId
          )) {
            references.push({
              questionId: use.localId,
              location: use.location,
            });
          }
          assessmentData.set(assessmentId, references);
        }
        instances.set(instanceId, assessmentData);
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
