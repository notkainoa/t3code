import { ProjectId, ProjectTask, TaskId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const GetProjectTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type GetProjectTaskInput = typeof GetProjectTaskInput.Type;

export const DeleteProjectTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type DeleteProjectTaskInput = typeof DeleteProjectTaskInput.Type;

export const ListProjectTasksByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectTasksByProjectInput = typeof ListProjectTasksByProjectInput.Type;

export interface ProjectTaskRepositoryShape {
  readonly upsert: (row: ProjectTask) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectTaskInput,
  ) => Effect.Effect<Option.Option<ProjectTask>, ProjectionRepositoryError>;
  readonly listByProject: (
    input: ListProjectTasksByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTask>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeleteProjectTaskInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectTaskRepository extends Context.Service<
  ProjectTaskRepository,
  ProjectTaskRepositoryShape
>()("t3/persistence/Services/ProjectTaskRepository") {}
