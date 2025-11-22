import * as vscode from "vscode";

type LocalId = string;
type CourseId = string;
type QualifiedId = string;
type ScopedId = { courseId: CourseId; localId: LocalId };
type InstanceId = ScopedId;
type AssessmentId = {
  courseId: CourseId;
  qualifiedId: QualifiedId;
  instanceId: LocalId;
  assessmentId: LocalId;
};
type QuestionId = ScopedId;

type LocalIdUsage = {
  localId: LocalId;
  location: vscode.Location;
};

export type {
  AssessmentId,
  CourseId,
  InstanceId,
  LocalId,
  LocalIdUsage,
  QualifiedId,
  QuestionId,
  ScopedId,
};
