import { ProjectId, TaskId, TaskRunId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectTaskRepositoryLive } from "./ProjectTasks.ts";
import { ProjectTaskRunRepositoryLive } from "./ProjectTaskRuns.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectTaskRepository } from "../Services/ProjectTasks.ts";
import { ProjectTaskRunRepository } from "../Services/ProjectTaskRuns.ts";

const taskPersistenceLayer = it.layer(
  Layer.mergeAll(ProjectTaskRepositoryLive, ProjectTaskRunRepositoryLive).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

taskPersistenceLayer("Project task persistence", (it) => {
  it.effect("stores and reads project tasks with labels and blockers", () =>
    Effect.gen(function* () {
      const tasks = yield* ProjectTaskRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* tasks.upsert({
        id: TaskId.make("task-1"),
        projectId: ProjectId.make("project-1"),
        identifier: "ABC-123",
        title: "Ship board route",
        description: "Board shell",
        column: "Todo",
        columnKey: "todo",
        priority: "high",
        labels: ["ui", "board"],
        blockedBy: [TaskId.make("task-0")],
        sortOrder: 0,
        createdAt: "2026-05-20T00:00:00.000Z",
        updatedAt: "2026-05-20T01:00:00.000Z",
        runStatus: "queued",
        activeRunId: TaskRunId.make("run-1"),
        workspacePath: "/tmp/workspaces/task-1",
        latestActivity: "Queued",
        lastError: null,
      });

      const rows = yield* sql<{
        readonly labels: string;
        readonly blockedBy: string;
      }>`
        SELECT
          labels_json AS "labels",
          blocked_by_json AS "blockedBy"
        FROM project_tasks
        WHERE task_id = 'task-1'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.die("Expected project_tasks row to exist.");
      }

      assert.strictEqual(row.labels, '["ui","board"]');
      assert.strictEqual(row.blockedBy, '["task-0"]');

      const persisted = yield* tasks.getById({ taskId: TaskId.make("task-1") });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.labels, ["ui", "board"]);
      assert.deepStrictEqual(Option.getOrNull(persisted)?.blockedBy, [TaskId.make("task-0")]);
    }),
  );

  it.effect("stores and reads task runs with verification details", () =>
    Effect.gen(function* () {
      const runs = yield* ProjectTaskRunRepository;

      yield* runs.upsert({
        id: TaskRunId.make("run-1"),
        taskId: TaskId.make("task-1"),
        projectId: ProjectId.make("project-1"),
        status: "running",
        attempt: 1,
        workspacePath: "/tmp/workspaces/task-1",
        latestActivity: "Applying patch",
        lastError: null,
        startedAt: "2026-05-20T01:00:00.000Z",
        updatedAt: "2026-05-20T01:05:00.000Z",
        finishedAt: null,
        runtimeMs: 300000,
        tokenUsage: {
          inputTokens: 200,
          outputTokens: 50,
          totalTokens: 250,
        },
        artifacts: [
          {
            id: "artifact-1",
            kind: "log",
            label: "run.log",
            path: "/tmp/run.log",
            createdAt: "2026-05-20T01:05:00.000Z",
          },
        ],
        verification: {
          status: "running",
          commands: [{ command: "bun run typecheck", status: "pending", detail: null }],
          screenshots: [{ kind: "screenshot", label: "board", path: "/tmp/board.png" }],
        },
      });

      const persisted = yield* runs.getById({ runId: TaskRunId.make("run-1") });
      assert.strictEqual(Option.getOrNull(persisted)?.tokenUsage?.totalTokens, 250);
      assert.strictEqual(Option.getOrNull(persisted)?.verification?.screenshots.length, 1);
    }),
  );
});
