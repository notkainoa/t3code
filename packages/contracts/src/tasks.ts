import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  TaskId,
  TaskRunId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ProjectTaskColumn = Schema.Literals([
  "Backlog",
  "Todo",
  "In Progress",
  "Review",
  "Done",
]);
export type ProjectTaskColumn = typeof ProjectTaskColumn.Type;

export const ProjectTaskColumnKey = Schema.Literals([
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
]);
export type ProjectTaskColumnKey = typeof ProjectTaskColumnKey.Type;

export const ProjectTaskPriority = Schema.Literals(["none", "low", "medium", "high", "urgent"]);
export type ProjectTaskPriority = typeof ProjectTaskPriority.Type;

export const ProjectTaskRunStatus = Schema.Literals([
  "idle",
  "queued",
  "starting",
  "running",
  "retrying",
  "handoff",
  "succeeded",
  "failed",
  "canceled",
]);
export type ProjectTaskRunStatus = typeof ProjectTaskRunStatus.Type;

export const ProjectTaskArtifactKind = Schema.Literals([
  "log",
  "diff",
  "checkpoint",
  "screenshot",
  "report",
]);
export type ProjectTaskArtifactKind = typeof ProjectTaskArtifactKind.Type;

export const ProjectTaskVerificationStatus = Schema.Literals([
  "not_requested",
  "pending",
  "running",
  "passed",
  "failed",
]);
export type ProjectTaskVerificationStatus = typeof ProjectTaskVerificationStatus.Type;

export const ProjectTaskVerificationCommand = Schema.Struct({
  command: TrimmedNonEmptyString,
  status: ProjectTaskVerificationStatus,
  detail: Schema.NullOr(TrimmedNonEmptyString),
});
export type ProjectTaskVerificationCommand = typeof ProjectTaskVerificationCommand.Type;

export const ProjectTaskScreenshotArtifact = Schema.Struct({
  kind: Schema.Literal("screenshot"),
  label: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
});
export type ProjectTaskScreenshotArtifact = typeof ProjectTaskScreenshotArtifact.Type;

export const ProjectTaskArtifact = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ProjectTaskArtifactKind,
  label: TrimmedNonEmptyString,
  path: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type ProjectTaskArtifact = typeof ProjectTaskArtifact.Type;

export const ProjectTaskVerificationSummary = Schema.Struct({
  status: ProjectTaskVerificationStatus,
  commands: Schema.Array(ProjectTaskVerificationCommand).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  screenshots: Schema.Array(ProjectTaskScreenshotArtifact).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type ProjectTaskVerificationSummary = typeof ProjectTaskVerificationSummary.Type;

export const ProjectTaskRunTokenUsage = Schema.Struct({
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  totalTokens: NonNegativeInt,
});
export type ProjectTaskRunTokenUsage = typeof ProjectTaskRunTokenUsage.Type;

export const ProjectTaskRun = Schema.Struct({
  id: TaskRunId,
  taskId: TaskId,
  projectId: ProjectId,
  status: ProjectTaskRunStatus,
  attempt: NonNegativeInt,
  workspacePath: Schema.NullOr(TrimmedNonEmptyString),
  latestActivity: Schema.NullOr(TrimmedNonEmptyString),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  startedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
  runtimeMs: Schema.NullOr(NonNegativeInt),
  tokenUsage: Schema.NullOr(ProjectTaskRunTokenUsage),
  artifacts: Schema.Array(ProjectTaskArtifact).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  verification: Schema.NullOr(ProjectTaskVerificationSummary),
});
export type ProjectTaskRun = typeof ProjectTaskRun.Type;

export const ProjectTask = Schema.Struct({
  id: TaskId,
  projectId: ProjectId,
  identifier: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  column: ProjectTaskColumn,
  columnKey: ProjectTaskColumnKey,
  priority: ProjectTaskPriority,
  labels: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  blockedBy: Schema.Array(TaskId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  sortOrder: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  runStatus: ProjectTaskRunStatus,
  activeRunId: Schema.NullOr(TaskRunId),
  workspacePath: Schema.NullOr(TrimmedNonEmptyString),
  latestActivity: Schema.NullOr(TrimmedNonEmptyString),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
});
export type ProjectTask = typeof ProjectTask.Type;

export const ProjectTaskBoardColumnSnapshot = Schema.Struct({
  key: ProjectTaskColumnKey,
  label: ProjectTaskColumn,
  tasks: Schema.Array(ProjectTask),
});
export type ProjectTaskBoardColumnSnapshot = typeof ProjectTaskBoardColumnSnapshot.Type;

export const ProjectTaskBoardSnapshot = Schema.Struct({
  projectId: ProjectId,
  columns: Schema.Array(ProjectTaskBoardColumnSnapshot),
  activeRunCount: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type ProjectTaskBoardSnapshot = typeof ProjectTaskBoardSnapshot.Type;

export const GetProjectTaskBoardInput = Schema.Struct({
  projectId: ProjectId,
});
export type GetProjectTaskBoardInput = typeof GetProjectTaskBoardInput.Type;

export const GetProjectTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type GetProjectTaskInput = typeof GetProjectTaskInput.Type;

export const ListProjectTaskRunsInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectTaskRunsInput = typeof ListProjectTaskRunsInput.Type;

export const MoveProjectTaskInput = Schema.Struct({
  taskId: TaskId,
  column: ProjectTaskColumn,
  columnKey: ProjectTaskColumnKey,
});
export type MoveProjectTaskInput = typeof MoveProjectTaskInput.Type;

export const CreateProjectTaskInput = Schema.Struct({
  projectId: ProjectId,
  identifier: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  column: ProjectTaskColumn.pipe(Schema.withDecodingDefault(Effect.succeed("Todo"))),
  columnKey: ProjectTaskColumnKey.pipe(Schema.withDecodingDefault(Effect.succeed("todo"))),
  priority: ProjectTaskPriority.pipe(Schema.withDecodingDefault(Effect.succeed("none"))),
  labels: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  blockedBy: Schema.Array(TaskId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CreateProjectTaskInput = typeof CreateProjectTaskInput.Type;

export const UpdateProjectTaskInput = Schema.Struct({
  taskId: TaskId,
  identifier: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  priority: ProjectTaskPriority,
  labels: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  blockedBy: Schema.Array(TaskId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type UpdateProjectTaskInput = typeof UpdateProjectTaskInput.Type;

export const ReorderProjectTasksInput = Schema.Struct({
  projectId: ProjectId,
  columnKey: ProjectTaskColumnKey,
  orderedTaskIds: Schema.Array(TaskId),
});
export type ReorderProjectTasksInput = typeof ReorderProjectTasksInput.Type;

export const StartProjectTaskRunInput = Schema.Struct({
  taskId: TaskId,
  instanceId: Schema.optional(ProviderInstanceId),
});
export type StartProjectTaskRunInput = typeof StartProjectTaskRunInput.Type;

export const StopProjectTaskRunInput = Schema.Struct({
  taskId: TaskId,
});
export type StopProjectTaskRunInput = typeof StopProjectTaskRunInput.Type;

export const RetryProjectTaskRunInput = Schema.Struct({
  taskId: TaskId,
  instanceId: Schema.optional(ProviderInstanceId),
});
export type RetryProjectTaskRunInput = typeof RetryProjectTaskRunInput.Type;

export const ProjectTaskAssistantToolName = Schema.Literals([
  "list_projects",
  "list_project_tasks",
  "create_task",
  "update_task",
  "move_task",
  "reorder_task",
  "split_task",
  "summarize_board",
]);
export type ProjectTaskAssistantToolName = typeof ProjectTaskAssistantToolName.Type;

export const ProjectTaskAssistantToolCall = Schema.Struct({
  toolName: ProjectTaskAssistantToolName,
  summary: TrimmedNonEmptyString,
});
export type ProjectTaskAssistantToolCall = typeof ProjectTaskAssistantToolCall.Type;

export const ProjectTaskAssistantRequest = Schema.Struct({
  projectId: ProjectId,
  message: TrimmedNonEmptyString,
});
export type ProjectTaskAssistantRequest = typeof ProjectTaskAssistantRequest.Type;

export const ProjectTaskAssistantResponse = Schema.Struct({
  reply: TrimmedNonEmptyString,
  toolCalls: Schema.Array(ProjectTaskAssistantToolCall).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type ProjectTaskAssistantResponse = typeof ProjectTaskAssistantResponse.Type;

export class ProjectTaskBoardError extends Schema.TaggedErrorClass<ProjectTaskBoardError>()(
  "ProjectTaskBoardError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class ProjectTaskNotFoundError extends Schema.TaggedErrorClass<ProjectTaskNotFoundError>()(
  "ProjectTaskNotFoundError",
  {
    taskId: TaskId,
  },
) {
  override get message(): string {
    return `Unknown task: ${this.taskId}`;
  }
}

export class ProjectTaskAssistantError extends Schema.TaggedErrorClass<ProjectTaskAssistantError>()(
  "ProjectTaskAssistantError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
