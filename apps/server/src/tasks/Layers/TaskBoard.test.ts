import { ProjectId, ProviderDriverKind, ProviderInstanceId, TaskId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ProjectTaskRepositoryLive } from "../../persistence/Layers/ProjectTasks.ts";
import { ProjectTaskRunRepositoryLive } from "../../persistence/Layers/ProjectTaskRuns.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { TaskRunExecutor } from "../../taskRunner/TaskRunExecutor.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../../provider/providerMaintenance.ts";
import { TaskBoard } from "../Services/TaskBoard.ts";
import { TaskBoardLive } from "./TaskBoard.ts";

const TaskPersistenceLayer = Layer.mergeAll(
  ProjectTaskRepositoryLive,
  ProjectTaskRunRepositoryLive,
).pipe(Layer.provideMerge(SqlitePersistenceMemory));

const ProviderRegistryTestLayer = Layer.mock(ProviderRegistry)({
  getProviders: Effect.succeed([
    {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-05-20T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
      taskExecution: { status: "runnable" },
    },
    {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      driver: ProviderDriverKind.make("claudeAgent"),
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-05-20T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
      taskExecution: {
        status: "unavailable",
        reason:
          "Unavailable in service mode. Only Codex task execution ships in the first version.",
      },
    },
  ]),
  refresh: () => Effect.succeed([]),
  refreshInstance: () => Effect.succeed([]),
  getProviderMaintenanceCapabilitiesForInstance: (_instanceId, provider) =>
    Effect.succeed(makeManualOnlyProviderMaintenanceCapabilities({ provider, packageName: null })),
  setProviderMaintenanceActionState: () => Effect.succeed([]),
  streamChanges: Stream.empty,
});

const TaskBoardTestLayer = it.layer(
  TaskBoardLive.pipe(
    Layer.provideMerge(TaskPersistenceLayer),
    Layer.provideMerge(ProviderRegistryTestLayer),
    Layer.provide(
      Layer.succeed(TaskRunExecutor, {
        enqueueRun: () => Effect.void,
        cancelRun: () => Effect.void,
      }),
    ),
  ),
);

TaskBoardTestLayer("TaskBoardLive", (it) => {
  it.effect("groups project tasks into board columns", () =>
    Effect.gen(function* () {
      const board = yield* TaskBoard;

      yield* board.createTask({
        projectId: ProjectId.make("project-1"),
        identifier: "ABC-123",
        title: "Ship board route",
        description: null,
        column: "Todo",
        columnKey: "todo",
        priority: "high",
        labels: [],
        blockedBy: [],
      });
      yield* board.createTask({
        projectId: ProjectId.make("project-1"),
        identifier: "ABC-124",
        title: "Ship task detail route",
        description: null,
        column: "Review",
        columnKey: "review",
        priority: "medium",
        labels: [],
        blockedBy: [],
      });

      const snapshot = yield* board.getBoard(ProjectId.make("project-1"));

      assert.strictEqual(snapshot.columns.length, 5);
      assert.strictEqual(snapshot.columns.find((column) => column.key === "todo")?.tasks.length, 1);
      assert.strictEqual(
        snapshot.columns.find((column) => column.key === "review")?.tasks[0]?.identifier,
        "ABC-124",
      );
      assert.strictEqual(snapshot.activeRunCount, 0);
    }),
  );

  it.effect("moves tasks between columns and fails for unknown tasks", () =>
    Effect.gen(function* () {
      const board = yield* TaskBoard;

      const task = yield* board.createTask({
        projectId: ProjectId.make("project-1"),
        identifier: "ABC-125",
        title: "Move me",
        description: null,
        column: "Backlog",
        columnKey: "backlog",
        priority: "none",
        labels: [],
        blockedBy: [],
      });

      const moved = yield* board.moveTask({
        taskId: task.id,
        column: "In Progress",
        columnKey: "in_progress",
      });
      assert.strictEqual(moved.columnKey, "in_progress");

      const exit = yield* Effect.exit(
        board.moveTask({
          taskId: TaskId.make("task-missing"),
          column: "Done",
          columnKey: "done",
        }),
      );
      assert.strictEqual(Exit.isFailure(exit), true);
    }),
  );

  it.effect("reorders tasks within a column using persistent sort order", () =>
    Effect.gen(function* () {
      const board = yield* TaskBoard;

      const first = yield* board.createTask({
        projectId: ProjectId.make("project-2"),
        identifier: "ABC-201",
        title: "First",
        description: null,
        column: "Todo",
        columnKey: "todo",
        priority: "none",
        labels: [],
        blockedBy: [],
      });
      const second = yield* board.createTask({
        projectId: ProjectId.make("project-2"),
        identifier: "ABC-202",
        title: "Second",
        description: null,
        column: "Todo",
        columnKey: "todo",
        priority: "none",
        labels: [],
        blockedBy: [],
      });

      const reordered = yield* board.reorderTasks({
        projectId: ProjectId.make("project-2"),
        columnKey: "todo",
        orderedTaskIds: [second.id, first.id],
      });

      assert.deepStrictEqual(
        reordered.map((task) => [task.identifier, task.sortOrder]),
        [
          ["ABC-202", 0],
          ["ABC-201", 1],
        ],
      );

      const boardSnapshot = yield* board.getBoard(ProjectId.make("project-2"));
      assert.deepStrictEqual(
        boardSnapshot.columns
          .find((column) => column.key === "todo")
          ?.tasks.map((task) => task.identifier),
        ["ABC-202", "ABC-201"],
      );
    }),
  );

  it.effect("starts, stops, and retries runs while rejecting non-codex providers", () =>
    Effect.gen(function* () {
      const board = yield* TaskBoard;

      const task = yield* board.createTask({
        projectId: ProjectId.make("project-3"),
        identifier: "ABC-301",
        title: "Run me",
        description: null,
        column: "Todo",
        columnKey: "todo",
        priority: "high",
        labels: [],
        blockedBy: [],
      });

      const started = yield* board.startRun({
        taskId: task.id,
        instanceId: ProviderInstanceId.make("codex"),
      });
      assert.strictEqual(started.status, "queued");

      const stopResult = yield* board.stopRun({ taskId: task.id });
      assert.strictEqual(stopResult.status, "canceled");

      const retried = yield* board.retryRun({ taskId: task.id });
      assert.strictEqual(retried.status, "retrying");

      const blockedTask = yield* board.createTask({
        projectId: ProjectId.make("project-3"),
        identifier: "ABC-302",
        title: "Wrong provider",
        description: null,
        column: "Todo",
        columnKey: "todo",
        priority: "medium",
        labels: [],
        blockedBy: [],
      });

      const blockedExit = yield* Effect.exit(
        board.startRun({
          taskId: blockedTask.id,
          instanceId: ProviderInstanceId.make("claudeAgent"),
        }),
      );
      assert.strictEqual(Exit.isFailure(blockedExit), true);
    }),
  );
});
