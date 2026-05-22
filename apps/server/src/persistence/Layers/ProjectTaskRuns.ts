import {
  ProjectTaskArtifact,
  ProjectTaskRun,
  ProjectTaskRunTokenUsage,
  ProjectTaskVerificationSummary,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Struct from "effect/Struct";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectTaskRunInput,
  GetProjectTaskRunInput,
  ListProjectTaskRunsByProjectInput,
  ListProjectTaskRunsByTaskInput,
  ProjectTaskRunRepository,
  type ProjectTaskRunRepositoryShape,
} from "../Services/ProjectTaskRuns.ts";

const ProjectTaskRunDbRow = ProjectTaskRun.mapFields(
  Struct.assign({
    tokenUsage: Schema.NullOr(Schema.fromJsonString(ProjectTaskRunTokenUsage)),
    artifacts: Schema.fromJsonString(Schema.Array(ProjectTaskArtifact)),
    verification: Schema.NullOr(Schema.fromJsonString(ProjectTaskVerificationSummary)),
  }),
);
type ProjectTaskRunDbRow = typeof ProjectTaskRunDbRow.Type;

const makeProjectTaskRunRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectTaskRunRow = SqlSchema.void({
    Request: ProjectTaskRun,
    execute: (row) =>
      sql`
        INSERT INTO project_task_runs (
          run_id,
          task_id,
          project_id,
          status,
          attempt,
          workspace_path,
          latest_activity,
          last_error,
          started_at,
          updated_at,
          finished_at,
          runtime_ms,
          token_usage_json,
          artifacts_json,
          verification_json
        )
        VALUES (
          ${row.id},
          ${row.taskId},
          ${row.projectId},
          ${row.status},
          ${row.attempt},
          ${row.workspacePath},
          ${row.latestActivity},
          ${row.lastError},
          ${row.startedAt},
          ${row.updatedAt},
          ${row.finishedAt},
          ${row.runtimeMs},
          ${row.tokenUsage !== null ? JSON.stringify(row.tokenUsage) : null},
          ${JSON.stringify(row.artifacts)},
          ${row.verification !== null ? JSON.stringify(row.verification) : null}
        )
        ON CONFLICT (run_id)
        DO UPDATE SET
          task_id = excluded.task_id,
          project_id = excluded.project_id,
          status = excluded.status,
          attempt = excluded.attempt,
          workspace_path = excluded.workspace_path,
          latest_activity = excluded.latest_activity,
          last_error = excluded.last_error,
          started_at = excluded.started_at,
          updated_at = excluded.updated_at,
          finished_at = excluded.finished_at,
          runtime_ms = excluded.runtime_ms,
          token_usage_json = excluded.token_usage_json,
          artifacts_json = excluded.artifacts_json,
          verification_json = excluded.verification_json
      `,
  });

  const getProjectTaskRunRow = SqlSchema.findOneOption({
    Request: GetProjectTaskRunInput,
    Result: ProjectTaskRunDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          run_id AS "id",
          task_id AS "taskId",
          project_id AS "projectId",
          status,
          attempt,
          workspace_path AS "workspacePath",
          latest_activity AS "latestActivity",
          last_error AS "lastError",
          started_at AS "startedAt",
          updated_at AS "updatedAt",
          finished_at AS "finishedAt",
          runtime_ms AS "runtimeMs",
          token_usage_json AS "tokenUsage",
          artifacts_json AS "artifacts",
          verification_json AS "verification"
        FROM project_task_runs
        WHERE run_id = ${runId}
      `,
  });

  const listProjectTaskRunRowsByProject = SqlSchema.findAll({
    Request: ListProjectTaskRunsByProjectInput,
    Result: ProjectTaskRunDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          run_id AS "id",
          task_id AS "taskId",
          project_id AS "projectId",
          status,
          attempt,
          workspace_path AS "workspacePath",
          latest_activity AS "latestActivity",
          last_error AS "lastError",
          started_at AS "startedAt",
          updated_at AS "updatedAt",
          finished_at AS "finishedAt",
          runtime_ms AS "runtimeMs",
          token_usage_json AS "tokenUsage",
          artifacts_json AS "artifacts",
          verification_json AS "verification"
        FROM project_task_runs
        WHERE project_id = ${projectId}
        ORDER BY updated_at DESC, run_id ASC
      `,
  });

  const listProjectTaskRunRowsByTask = SqlSchema.findAll({
    Request: ListProjectTaskRunsByTaskInput,
    Result: ProjectTaskRunDbRow,
    execute: ({ taskId }) =>
      sql`
        SELECT
          run_id AS "id",
          task_id AS "taskId",
          project_id AS "projectId",
          status,
          attempt,
          workspace_path AS "workspacePath",
          latest_activity AS "latestActivity",
          last_error AS "lastError",
          started_at AS "startedAt",
          updated_at AS "updatedAt",
          finished_at AS "finishedAt",
          runtime_ms AS "runtimeMs",
          token_usage_json AS "tokenUsage",
          artifacts_json AS "artifacts",
          verification_json AS "verification"
        FROM project_task_runs
        WHERE task_id = ${taskId}
        ORDER BY updated_at DESC, run_id ASC
      `,
  });

  const deleteProjectTaskRunRow = SqlSchema.void({
    Request: DeleteProjectTaskRunInput,
    execute: ({ runId }) =>
      sql`
        DELETE FROM project_task_runs
        WHERE run_id = ${runId}
      `,
  });

  const upsert: ProjectTaskRunRepositoryShape["upsert"] = (row) =>
    upsertProjectTaskRunRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTaskRunRepository.upsert:query")),
    );

  const getById: ProjectTaskRunRepositoryShape["getById"] = (input) =>
    getProjectTaskRunRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTaskRunRepository.getById:query")),
    );

  const listByProject: ProjectTaskRunRepositoryShape["listByProject"] = (input) =>
    listProjectTaskRunRowsByProject(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTaskRunRepository.listByProject:query")),
    );

  const listByTask: ProjectTaskRunRepositoryShape["listByTask"] = (input) =>
    listProjectTaskRunRowsByTask(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTaskRunRepository.listByTask:query")),
    );

  const deleteById: ProjectTaskRunRepositoryShape["deleteById"] = (input) =>
    deleteProjectTaskRunRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTaskRunRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listByProject,
    listByTask,
    deleteById,
  } satisfies ProjectTaskRunRepositoryShape;
});

export const ProjectTaskRunRepositoryLive = Layer.effect(
  ProjectTaskRunRepository,
  makeProjectTaskRunRepository,
);
