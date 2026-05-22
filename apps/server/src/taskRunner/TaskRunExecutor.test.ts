import {
  EventId,
  ProjectId,
  ProjectTaskBoardError,
  type ProviderEvent,
  ProviderDriverKind,
  TaskId,
  TaskRunId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { TestClock } from "effect/testing";

import { ProjectTaskRunRepositoryLive } from "../persistence/Layers/ProjectTaskRuns.ts";
import { ProjectTaskRepositoryLive } from "../persistence/Layers/ProjectTasks.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectTaskRunRepository } from "../persistence/Services/ProjectTaskRuns.ts";
import { ProjectTaskRepository } from "../persistence/Services/ProjectTasks.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProcessRunner, type ProcessRunOutput } from "../processRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TaskWorkspaceManager } from "./WorkspaceManager.ts";
import type {
  CodexSessionRuntimeOptions,
  CodexSessionRuntimeShape,
} from "../provider/Layers/CodexSessionRuntime.ts";
import {
  TaskRunCodexRuntimeFactory,
  TaskRunExecutor,
  TaskRunExecutorLayer,
} from "./TaskRunExecutor.ts";

const TaskPersistenceLayer = Layer.mergeAll(
  ProjectTaskRepositoryLive,
  ProjectTaskRunRepositoryLive,
).pipe(Layer.provideMerge(SqlitePersistenceMemory));

function makeProjectionSnapshotQueryLayer(workspaceRoot: string) {
  return Layer.succeed(ProjectionSnapshotQuery, {
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
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
          workspaceRoot,
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
}

const ProcessRunnerTestLayer = Layer.succeed(ProcessRunner, {
  run: () =>
    Effect.succeed<ProcessRunOutput>({
      stdout: "ok",
      stderr: "",
      code: 0 as ProcessRunOutput["code"],
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    }),
});

const TaskWorkspaceManagerTestLayer = Layer.succeed(TaskWorkspaceManager, {
  sanitizeTaskWorkspaceKey: (taskIdentifier: string) => taskIdentifier,
  prepareWorkspace: (input: { readonly workspaceRoot: string; readonly taskIdentifier: string }) =>
    Effect.succeed({
      workspaceRoot: input.workspaceRoot,
      workspacePath: `${input.workspaceRoot}/${input.taskIdentifier}`,
      workspaceKey: input.taskIdentifier,
      createdNow: true,
    }),
  runBeforeRunHooks: () => Effect.void,
  runAfterRunHooks: () => Effect.void,
  removeWorkspace: () => Effect.void,
  assertWorkspaceCwd: () => Effect.void,
});

function makeRuntimeFactoryLayer() {
  return Layer.effect(
    TaskRunCodexRuntimeFactory,
    Effect.succeed(
      TaskRunCodexRuntimeFactory.of({
        make: (_options: CodexSessionRuntimeOptions) =>
          Effect.succeed<CodexSessionRuntimeShape>({
            start: () =>
              Effect.succeed({
                provider: ProviderDriverKind.make("codex"),
                threadId: ThreadId.make("task-run-thread"),
                status: "ready",
                runtimeMode: "full-access",
                cwd: "/tmp/task-run-thread",
                createdAt: "2026-05-21T00:00:00.000Z",
                updatedAt: "2026-05-21T00:00:00.000Z",
              } as never),
            getSession: Effect.die("unused"),
            sendTurn: () => Effect.succeed({ turnId: "turn-1" } as never),
            interruptTurn: () => Effect.void,
            readThread: Effect.die("unused"),
            rollbackThread: () => Effect.die("unused"),
            respondToRequest: () => Effect.void,
            respondToUserInput: () => Effect.void,
            events: Stream.fromIterable([
              {
                id: EventId.make("evt-1"),
                kind: "notification",
                provider: ProviderDriverKind.make("codex"),
                threadId: ThreadId.make("task-run-thread"),
                createdAt: "2026-05-21T00:00:01.000Z",
                method: "turn/started",
              },
              {
                id: EventId.make("evt-2"),
                kind: "notification",
                provider: ProviderDriverKind.make("codex"),
                threadId: ThreadId.make("task-run-thread"),
                createdAt: "2026-05-21T00:00:02.000Z",
                method: "thread/tokenUsage/updated",
                payload: {
                  tokenUsage: {
                    inputTokens: 10,
                    outputTokens: 20,
                    totalProcessedTokens: 30,
                  },
                },
              },
              {
                id: EventId.make("evt-3"),
                kind: "notification",
                provider: ProviderDriverKind.make("codex"),
                threadId: ThreadId.make("task-run-thread"),
                createdAt: "2026-05-21T00:00:03.000Z",
                method: "turn/completed",
                payload: {
                  turn: {
                    status: "completed",
                  },
                },
              },
            ] satisfies ReadonlyArray<ProviderEvent>),
            close: Effect.void,
          }),
      }),
    ),
  );
}

const makeTaskRunExecutorTestLayer = (workspaceRoot: string) =>
  TaskRunExecutorLayer.pipe(
    Layer.provideMerge(TaskPersistenceLayer),
    Layer.provideMerge(makeProjectionSnapshotQueryLayer(workspaceRoot)),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(ProcessRunnerTestLayer),
    Layer.provideMerge(TaskWorkspaceManagerTestLayer),
    Layer.provideMerge(makeRuntimeFactoryLayer()),
  );

const TaskRunExecutorTestLayer = it.layer(NodeServices.layer);

function seedTaskAndRun() {
  return Effect.gen(function* () {
    const tasks = yield* ProjectTaskRepository;
    const runs = yield* ProjectTaskRunRepository;

    yield* tasks.upsert({
      id: TaskId.make("task-1"),
      projectId: ProjectId.make("project-1"),
      identifier: "ABC-123",
      title: "Ship background executor",
      description: null,
      column: "Todo",
      columnKey: "todo",
      priority: "high",
      labels: [],
      blockedBy: [],
      sortOrder: 0,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      runStatus: "queued",
      activeRunId: TaskRunId.make("run-1"),
      workspacePath: null,
      latestActivity: null,
      lastError: null,
    });
    yield* runs.upsert({
      id: TaskRunId.make("run-1"),
      taskId: TaskId.make("task-1"),
      projectId: ProjectId.make("project-1"),
      status: "queued",
      attempt: 1,
      workspacePath: null,
      latestActivity: null,
      lastError: null,
      startedAt: null,
      updatedAt: "2026-05-21T00:00:00.000Z",
      finishedAt: null,
      runtimeMs: null,
      tokenUsage: null,
      artifacts: [],
      verification: null,
    });
  });
}

function waitForRunStatus(runId: TaskRunId, status: string) {
  return Effect.gen(function* () {
    const runs = yield* ProjectTaskRunRepository;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = yield* runs.getById({ runId });
      if (Option.isSome(run) && run.value.status === status) {
        return run.value;
      }
      yield* TestClock.adjust("10 millis").pipe(Effect.andThen(Effect.yieldNow));
    }
    const finalRun = yield* runs.getById({ runId });
    return yield* new ProjectTaskBoardError({
      message: `Timed out waiting for run ${runId} to reach ${status}. Current status: ${
        Option.isSome(finalRun)
          ? `${finalRun.value.status}; lastError=${finalRun.value.lastError ?? "null"}; latestActivity=${finalRun.value.latestActivity ?? "null"}`
          : "missing"
      }`,
    });
  });
}

TaskRunExecutorTestLayer("TaskRunExecutorLive", (it) => {
  it.effect("executes a queued run and records verification/artifacts", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceRoot = path.join(process.cwd(), ".tmp", "task-runner-success");
      yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(workspaceRoot, "WORKFLOW.md"),
        `---
verification:
  commands: [echo verify]
---
Task {{ task.identifier }}`,
      );

      const executor = yield* TaskRunExecutor;
      const tasks = yield* ProjectTaskRepository;

      yield* seedTaskAndRun();

      yield* executor.enqueueRun({ runId: TaskRunId.make("run-1") });
      const completedRun = yield* waitForRunStatus(TaskRunId.make("run-1"), "succeeded");
      const taskOption = yield* tasks.getById({ taskId: TaskId.make("task-1") });

      assert.strictEqual(completedRun.verification?.status, "passed");
      assert.strictEqual(completedRun.tokenUsage?.totalTokens, 30);
      assert.strictEqual(completedRun.artifacts.length >= 1, true);
      assert.strictEqual(Option.getOrNull(taskOption)?.columnKey, "review");
    }).pipe(
      Effect.provide(makeTaskRunExecutorTestLayer(`${process.cwd()}/.tmp/task-runner-success`)),
      Effect.scoped,
    ),
  );

  it.effect("marks a run failed when WORKFLOW.md is missing", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceRoot = path.join(process.cwd(), ".tmp", "task-runner-missing-workflow");
      yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });

      const executor = yield* TaskRunExecutor;
      yield* seedTaskAndRun();

      yield* executor.enqueueRun({ runId: TaskRunId.make("run-1") });
      const failedRun = yield* waitForRunStatus(TaskRunId.make("run-1"), "failed");

      assert.strictEqual(failedRun.lastError?.includes("Workflow file not found"), true);
    }).pipe(
      Effect.provide(
        makeTaskRunExecutorTestLayer(`${process.cwd()}/.tmp/task-runner-missing-workflow`),
      ),
      Effect.scoped,
    ),
  );
});
