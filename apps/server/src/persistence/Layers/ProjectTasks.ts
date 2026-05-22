import { ProjectTask, TaskId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Struct from "effect/Struct";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectTaskInput,
  GetProjectTaskInput,
  ListProjectTasksByProjectInput,
  ProjectTaskRepository,
  type ProjectTaskRepositoryShape,
} from "../Services/ProjectTasks.ts";

const ProjectTaskDbRow = ProjectTask.mapFields(
  Struct.assign({
    labels: Schema.fromJsonString(Schema.Array(TrimmedNonEmptyString)),
    blockedBy: Schema.fromJsonString(Schema.Array(TaskId)),
  }),
);
type ProjectTaskDbRow = typeof ProjectTaskDbRow.Type;

const makeProjectTaskRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectTaskRow = SqlSchema.void({
    Request: ProjectTask,
    execute: (row) =>
      sql`
        INSERT INTO project_tasks (
          task_id,
          project_id,
          identifier,
          title,
          description,
          column_label,
          column_key,
          priority,
          labels_json,
          blocked_by_json,
          sort_order,
          created_at,
          updated_at,
          run_status,
          active_run_id,
          workspace_path,
          latest_activity,
          last_error
        )
        VALUES (
          ${row.id},
          ${row.projectId},
          ${row.identifier},
          ${row.title},
          ${row.description},
          ${row.column},
          ${row.columnKey},
          ${row.priority},
          ${JSON.stringify(row.labels)},
          ${JSON.stringify(row.blockedBy)},
          ${row.sortOrder},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.runStatus},
          ${row.activeRunId},
          ${row.workspacePath},
          ${row.latestActivity},
          ${row.lastError}
        )
        ON CONFLICT (task_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          identifier = excluded.identifier,
          title = excluded.title,
          description = excluded.description,
          column_label = excluded.column_label,
          column_key = excluded.column_key,
          priority = excluded.priority,
          labels_json = excluded.labels_json,
          blocked_by_json = excluded.blocked_by_json,
          sort_order = excluded.sort_order,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          run_status = excluded.run_status,
          active_run_id = excluded.active_run_id,
          workspace_path = excluded.workspace_path,
          latest_activity = excluded.latest_activity,
          last_error = excluded.last_error
      `,
  });

  const getProjectTaskRow = SqlSchema.findOneOption({
    Request: GetProjectTaskInput,
    Result: ProjectTaskDbRow,
    execute: ({ taskId }) =>
      sql`
        SELECT
          task_id AS "id",
          project_id AS "projectId",
          identifier,
          title,
          description,
          column_label AS "column",
          column_key AS "columnKey",
          priority,
          labels_json AS "labels",
          blocked_by_json AS "blockedBy",
          sort_order AS "sortOrder",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          run_status AS "runStatus",
          active_run_id AS "activeRunId",
          workspace_path AS "workspacePath",
          latest_activity AS "latestActivity",
          last_error AS "lastError"
        FROM project_tasks
        WHERE task_id = ${taskId}
      `,
  });

  const listProjectTaskRows = SqlSchema.findAll({
    Request: ListProjectTasksByProjectInput,
    Result: ProjectTaskDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          task_id AS "id",
          project_id AS "projectId",
          identifier,
          title,
          description,
          column_label AS "column",
          column_key AS "columnKey",
          priority,
          labels_json AS "labels",
          blocked_by_json AS "blockedBy",
          sort_order AS "sortOrder",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          run_status AS "runStatus",
          active_run_id AS "activeRunId",
          workspace_path AS "workspacePath",
          latest_activity AS "latestActivity",
          last_error AS "lastError"
        FROM project_tasks
        WHERE project_id = ${projectId}
        ORDER BY
          CASE column_key
            WHEN 'backlog' THEN 0
            WHEN 'todo' THEN 1
            WHEN 'in_progress' THEN 2
            WHEN 'review' THEN 3
            WHEN 'done' THEN 4
            ELSE 99
          END ASC,
          sort_order ASC,
          updated_at DESC,
          task_id ASC
      `,
  });

  const deleteProjectTaskRow = SqlSchema.void({
    Request: DeleteProjectTaskInput,
    execute: ({ taskId }) =>
      sql`
        DELETE FROM project_tasks
        WHERE task_id = ${taskId}
      `,
  });

  const upsert: ProjectTaskRepositoryShape["upsert"] = (row) =>
    upsertProjectTaskRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTaskRepository.upsert:query")),
    );

  const getById: ProjectTaskRepositoryShape["getById"] = (input) =>
    getProjectTaskRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTaskRepository.getById:query")),
    );

  const listByProject: ProjectTaskRepositoryShape["listByProject"] = (input) =>
    listProjectTaskRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTaskRepository.listByProject:query")),
    );

  const deleteById: ProjectTaskRepositoryShape["deleteById"] = (input) =>
    deleteProjectTaskRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTaskRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listByProject,
    deleteById,
  } satisfies ProjectTaskRepositoryShape;
});

export const ProjectTaskRepositoryLive = Layer.effect(
  ProjectTaskRepository,
  makeProjectTaskRepository,
);
