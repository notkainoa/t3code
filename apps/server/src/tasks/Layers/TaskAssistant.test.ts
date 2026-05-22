import { ProjectId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectTaskRepositoryLive } from "../../persistence/Layers/ProjectTasks.ts";
import { ProjectTaskRunRepositoryLive } from "../../persistence/Layers/ProjectTaskRuns.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { TaskRunExecutor } from "../../taskRunner/TaskRunExecutor.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../../provider/providerMaintenance.ts";
import { TaskBoard } from "../Services/TaskBoard.ts";
import { TaskAssistant } from "../Services/TaskAssistant.ts";
import { TaskBoardLive } from "./TaskBoard.ts";
import { TaskAssistantLive } from "./TaskAssistant.ts";

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
  ]),
  refresh: () => Effect.succeed([]),
  refreshInstance: () => Effect.succeed([]),
  getProviderMaintenanceCapabilitiesForInstance: (_instanceId, provider) =>
    Effect.succeed(makeManualOnlyProviderMaintenanceCapabilities({ provider, packageName: null })),
  setProviderMaintenanceActionState: () => Effect.succeed([]),
  streamChanges: Stream.empty,
});

const ProjectionSnapshotQueryTestLayer = Layer.succeed(ProjectionSnapshotQuery, {
  getCommandReadModel: () => Effect.die("unused"),
  getSnapshot: () =>
    Effect.succeed({
      snapshotSequence: 1,
      updatedAt: "2026-05-21T00:00:00.000Z",
      projects: [
        {
          id: ProjectId.make("project-1"),
          title: "Project One",
          workspaceRoot: "/repo/project-1",
          repositoryIdentity: null,
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-05-21T00:00:00.000Z",
          updatedAt: "2026-05-21T00:00:00.000Z",
          deletedAt: null,
        },
      ],
      threads: [],
    }),
  getShellSnapshot: () => Effect.die("unused"),
  getArchivedShellSnapshot: () => Effect.die("unused"),
  getSnapshotSequence: () => Effect.die("unused"),
  getCounts: () => Effect.die("unused"),
  getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
  getProjectShellById: () =>
    Effect.succeed(
      Option.some({
        id: ProjectId.make("project-1"),
        title: "Project One",
        workspaceRoot: "/repo/project-1",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-05-21T00:00:00.000Z",
        updatedAt: "2026-05-21T00:00:00.000Z",
      }),
    ),
  getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
  getThreadCheckpointContext: () => Effect.die("unused"),
  getFullThreadDiffContext: () => Effect.die("unused"),
  getThreadShellById: () => Effect.die("unused"),
  getThreadDetailById: () => Effect.die("unused"),
});

const TaskAssistantTestLayer = it.layer(
  TaskAssistantLive.pipe(
    Layer.provideMerge(
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
    ),
    Layer.provideMerge(TaskPersistenceLayer),
    Layer.provideMerge(ProjectionSnapshotQueryTestLayer),
  ),
);

TaskAssistantTestLayer("TaskAssistantLive", (it) => {
  it.effect("creates and moves tasks through the restricted assistant tool path", () =>
    Effect.gen(function* () {
      const board = yield* TaskBoard;
      const assistant = yield* TaskAssistant;

      yield* board.createTask({
        projectId: ProjectId.make("project-1"),
        identifier: "ABC-123",
        title: "Existing task",
        description: null,
        column: "Todo",
        columnKey: "todo",
        priority: "medium",
        labels: [],
        blockedBy: [],
      });

      const created = yield* assistant.respond({
        projectId: ProjectId.make("project-1"),
        message: "create task ABC-124: Add assistant sidebar in Todo priority high",
      });
      const moved = yield* assistant.respond({
        projectId: ProjectId.make("project-1"),
        message: "move task ABC-124 to Review",
      });
      const boardSnapshot = yield* board.getBoard(ProjectId.make("project-1"));

      assert.strictEqual(created.toolCalls[0]?.toolName, "create_task");
      assert.strictEqual(moved.toolCalls[0]?.toolName, "move_task");
      assert.strictEqual(
        boardSnapshot.columns.find((column) => column.key === "review")?.tasks[0]?.identifier,
        "ABC-124",
      );
    }),
  );

  it.effect("rejects disallowed tool names", () =>
    Effect.gen(function* () {
      const assistant = yield* TaskAssistant;
      const exit = yield* Effect.exit(
        assistant.invokeTool({
          toolName: "run_shell",
          projectId: ProjectId.make("project-1"),
          args: {},
        }),
      );

      assert.strictEqual(Exit.isFailure(exit), true);
    }),
  );

  it.effect("splits tasks into validated project tasks", () =>
    Effect.gen(function* () {
      const board = yield* TaskBoard;
      const assistant = yield* TaskAssistant;

      yield* board.createTask({
        projectId: ProjectId.make("project-1"),
        identifier: "ABC-125",
        title: "Split me",
        description: null,
        column: "Todo",
        columnKey: "todo",
        priority: "low",
        labels: ["assistant"],
        blockedBy: [],
      });

      const response = yield* assistant.respond({
        projectId: ProjectId.make("project-1"),
        message: "split task ABC-125 into Build panel | Add tests",
      });
      const boardSnapshot = yield* board.getBoard(ProjectId.make("project-1"));
      const todoIdentifiers =
        boardSnapshot.columns
          .find((column) => column.key === "todo")
          ?.tasks.map((task) => task.identifier) ?? [];

      assert.strictEqual(response.toolCalls[0]?.toolName, "split_task");
      assert.deepStrictEqual(todoIdentifiers.includes("ABC-125-1"), true);
      assert.deepStrictEqual(todoIdentifiers.includes("ABC-125-2"), true);
    }),
  );

  it.effect("summarizes and lists project data without filesystem access", () =>
    Effect.gen(function* () {
      const assistant = yield* TaskAssistant;

      const projects = yield* assistant.respond({
        projectId: ProjectId.make("project-1"),
        message: "list projects",
      });
      const summary = yield* assistant.respond({
        projectId: ProjectId.make("project-1"),
        message: "summarize board",
      });

      assert.strictEqual(projects.toolCalls[0]?.toolName, "list_projects");
      assert.strictEqual(summary.toolCalls[0]?.toolName, "summarize_board");
    }),
  );

  it.effect("returns a boundary reminder for unsupported requests", () =>
    Effect.gen(function* () {
      const assistant = yield* TaskAssistant;
      const response = yield* assistant.respond({
        projectId: ProjectId.make("project-1"),
        message: "run bun test and fix the repo",
      });

      assert.strictEqual(response.toolCalls.length, 0);
      assert.strictEqual(response.reply.includes("Restricted task assistant only."), true);
    }),
  );
});
