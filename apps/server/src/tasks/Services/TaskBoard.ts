import {
  CreateProjectTaskInput,
  MoveProjectTaskInput,
  ProjectTask,
  ProjectTaskBoardError,
  ProjectTaskBoardSnapshot,
  ProjectTaskNotFoundError,
  ProjectTaskRun,
  ProjectTaskRunStatus,
  ReorderProjectTasksInput,
  RetryProjectTaskRunInput,
  StartProjectTaskRunInput,
  StopProjectTaskRunInput,
  UpdateProjectTaskInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface TaskBoardShape {
  readonly getBoard: (
    projectId: ProjectTask["projectId"],
  ) => Effect.Effect<ProjectTaskBoardSnapshot, ProjectTaskBoardError>;
  readonly getTask: (
    taskId: ProjectTask["id"],
  ) => Effect.Effect<ProjectTask, ProjectTaskBoardError | ProjectTaskNotFoundError>;
  readonly createTask: (
    input: CreateProjectTaskInput,
  ) => Effect.Effect<ProjectTask, ProjectTaskBoardError>;
  readonly updateTask: (
    input: UpdateProjectTaskInput,
  ) => Effect.Effect<ProjectTask, ProjectTaskBoardError | ProjectTaskNotFoundError>;
  readonly moveTask: (
    input: MoveProjectTaskInput,
  ) => Effect.Effect<ProjectTask, ProjectTaskBoardError | ProjectTaskNotFoundError>;
  readonly reorderTasks: (
    input: ReorderProjectTasksInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTask>, ProjectTaskBoardError | ProjectTaskNotFoundError>;
  readonly listRuns: (
    projectId: ProjectTask["projectId"],
  ) => Effect.Effect<ReadonlyArray<ProjectTaskRun>, ProjectTaskBoardError>;
  readonly startRun: (
    input: StartProjectTaskRunInput,
  ) => Effect.Effect<ProjectTaskRun, ProjectTaskBoardError | ProjectTaskNotFoundError>;
  readonly stopRun: (
    input: StopProjectTaskRunInput,
  ) => Effect.Effect<ProjectTaskRun, ProjectTaskBoardError | ProjectTaskNotFoundError>;
  readonly retryRun: (
    input: RetryProjectTaskRunInput,
  ) => Effect.Effect<ProjectTaskRun, ProjectTaskBoardError | ProjectTaskNotFoundError>;
  readonly upsertRun: (run: ProjectTaskRun) => Effect.Effect<ProjectTaskRun, ProjectTaskBoardError>;
}

export class TaskBoard extends Context.Service<TaskBoard, TaskBoardShape>()(
  "t3/tasks/Services/TaskBoard",
) {}

export const ACTIVE_TASK_RUN_STATUSES: ReadonlyArray<ProjectTaskRunStatus> = [
  "queued",
  "starting",
  "running",
  "retrying",
];
