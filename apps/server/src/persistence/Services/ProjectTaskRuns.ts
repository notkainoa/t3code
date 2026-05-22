import { ProjectId, ProjectTaskRun, TaskId, TaskRunId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const GetProjectTaskRunInput = Schema.Struct({
  runId: TaskRunId,
});
export type GetProjectTaskRunInput = typeof GetProjectTaskRunInput.Type;

export const DeleteProjectTaskRunInput = Schema.Struct({
  runId: TaskRunId,
});
export type DeleteProjectTaskRunInput = typeof DeleteProjectTaskRunInput.Type;

export const ListProjectTaskRunsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectTaskRunsByProjectInput = typeof ListProjectTaskRunsByProjectInput.Type;

export const ListProjectTaskRunsByTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type ListProjectTaskRunsByTaskInput = typeof ListProjectTaskRunsByTaskInput.Type;

export interface ProjectTaskRunRepositoryShape {
  readonly upsert: (row: ProjectTaskRun) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectTaskRunInput,
  ) => Effect.Effect<Option.Option<ProjectTaskRun>, ProjectionRepositoryError>;
  readonly listByProject: (
    input: ListProjectTaskRunsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTaskRun>, ProjectionRepositoryError>;
  readonly listByTask: (
    input: ListProjectTaskRunsByTaskInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTaskRun>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeleteProjectTaskRunInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectTaskRunRepository extends Context.Service<
  ProjectTaskRunRepository,
  ProjectTaskRunRepositoryShape
>()("t3/persistence/Services/ProjectTaskRunRepository") {}
