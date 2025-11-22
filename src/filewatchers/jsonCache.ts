import { CourseId, LocalId, LocalIdUsage } from "../utils";
import {
  AssessmentCache,
  CourseCache,
  CourseInstanceCache,
  QuestionCache,
} from "./index";

type AssessmentData = LocalIdUsage[];
type InstanceData = Map<LocalId, AssessmentData>;
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
    const onUpdate = () => {
      const data = this.rebuild();
      console.log(
        JSON.stringify(
          Object.fromEntries(
            [...data.entries()].map(([k, v]) => [
              k,
              {
                questions: [...v.questions],
                instances: Object.fromEntries(
                  [...v.instances.entries()].map(([k, v]) => [
                    k,
                    Object.fromEntries(
                      [...v.entries()].map(([k, v]) => [
                        k,
                        v.map(({ localId, location }) => ({
                          localId,
                          at: location.range.start,
                        })),
                      ])
                    ),
                  ])
                ),
              },
            ])
          ),
          undefined,
          2
        )
      );
    };
    courseCache.onUpdated(() => onUpdate());
    courseInstanceCache.onUpdated(() => onUpdate());
    assessmentCache.onUpdated(() => onUpdate());
    questionCache.onUpdated(() => onUpdate());
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
