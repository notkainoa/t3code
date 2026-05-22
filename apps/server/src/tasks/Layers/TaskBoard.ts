import {
  getProviderTaskExecution,
  ProviderInstanceId,
  ProjectTaskBoardError,
  ProjectTaskColumn,
  ProjectTaskColumnKey,
  ProjectTaskNotFoundError,
  TaskId,
  TaskRunId,
  type ProjectTask,
  type ProjectTaskRun,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ProjectTaskRepository } from "../../persistence/Services/ProjectTasks.ts";
import { ProjectTaskRunRepository } from "../../persistence/Services/ProjectTaskRuns.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { TaskRunExecutor } from "../../taskRunner/TaskRunExecutor.ts";
import { TaskBoard, type TaskBoardShape, ACTIVE_TASK_RUN_STATUSES } from "../Services/TaskBoard.ts";

const BOARD_COLUMNS: ReadonlyArray<{
  readonly key: typeof ProjectTaskColumnKey.Type;
  readonly label: typeof ProjectTaskColumn.Type;
}> = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "Todo" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

const COLUMN_LABEL_BY_KEY = new Map(BOARD_COLUMNS.map((column) => [column.key, column.label]));

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function toTaskBoardError(message: string) {
  return (cause: unknown) =>
    new ProjectTaskBoardError({
      message,
      cause,
    });
}

const makeTaskBoard = Effect.gen(function* () {
  const tasks = yield* ProjectTaskRepository;
  const runs = yield* ProjectTaskRunRepository;
  const providerRegistry = yield* ProviderRegistry;
  const taskRunExecutor = yield* TaskRunExecutor;

  const getBoard: TaskBoardShape["getBoard"] = Effect.fn("TaskBoard.getBoard")(
    function* (projectId) {
      const rows = yield* tasks
        .listByProject({ projectId })
        .pipe(Effect.mapError(toTaskBoardError("Failed to list project tasks.")));

      const columns = BOARD_COLUMNS.map((column) => ({
        key: column.key,
        label: column.label,
        tasks: rows.filter((task) => task.columnKey === column.key),
      }));
      const activeRunCount = rows.filter(
        (task) => task.activeRunId !== null || ACTIVE_TASK_RUN_STATUSES.includes(task.runStatus),
      ).length;

      return {
        projectId,
        columns,
        activeRunCount,
        updatedAt: rows[0]?.updatedAt ?? (yield* nowIso),
      };
    },
  );

  const getTask: TaskBoardShape["getTask"] = Effect.fn("TaskBoard.getTask")(function* (taskId) {
    const task = yield* tasks
      .getById({ taskId })
      .pipe(Effect.mapError(toTaskBoardError("Failed to read project task.")));
    if (Option.isNone(task)) {
      return yield* new ProjectTaskNotFoundError({ taskId });
    }
    return task.value;
  });

  const createTask: TaskBoardShape["createTask"] = Effect.fn("TaskBoard.createTask")(
    function* (input) {
      const projectTasks = yield* tasks
        .listByProject({ projectId: input.projectId })
        .pipe(Effect.mapError(toTaskBoardError("Failed to list project tasks.")));
      const sortOrder =
        projectTasks
          .filter((task) => task.columnKey === input.columnKey)
          .reduce((max, task) => Math.max(max, task.sortOrder), -1) + 1;
      const createdAt = yield* nowIso;
      const task: ProjectTask = {
        id: TaskId.make(crypto.randomUUID()),
        projectId: input.projectId,
        identifier: input.identifier,
        title: input.title,
        description: input.description,
        column: input.column,
        columnKey: input.columnKey,
        priority: input.priority,
        labels: input.labels,
        blockedBy: input.blockedBy,
        sortOrder,
        createdAt,
        updatedAt: createdAt,
        runStatus: "idle",
        activeRunId: null,
        workspacePath: null,
        latestActivity: null,
        lastError: null,
      };
      yield* tasks
        .upsert(task)
        .pipe(Effect.mapError(toTaskBoardError("Failed to create project task.")));
      return task;
    },
  );

  const updateTask: TaskBoardShape["updateTask"] = Effect.fn("TaskBoard.updateTask")(
    function* (input) {
      const existing = yield* getTask(input.taskId);
      const nextTask: ProjectTask = {
        ...existing,
        identifier: input.identifier,
        title: input.title,
        description: input.description,
        priority: input.priority,
        labels: input.labels,
        blockedBy: input.blockedBy,
        updatedAt: yield* nowIso,
      };
      yield* tasks
        .upsert(nextTask)
        .pipe(Effect.mapError(toTaskBoardError("Failed to update project task.")));
      return nextTask;
    },
  );

  const moveTask: TaskBoardShape["moveTask"] = Effect.fn("TaskBoard.moveTask")(function* (input) {
    const existing = yield* getTask(input.taskId);
    const projectTasks = yield* tasks
      .listByProject({ projectId: existing.projectId })
      .pipe(Effect.mapError(toTaskBoardError("Failed to list project tasks.")));
    const nextSortOrder =
      projectTasks
        .filter((task) => task.columnKey === input.columnKey && task.id !== existing.id)
        .reduce((max, task) => Math.max(max, task.sortOrder), -1) + 1;
    const nextTask = {
      ...existing,
      column: input.column,
      columnKey: input.columnKey,
      sortOrder: nextSortOrder,
      updatedAt: yield* nowIso,
    } as const;
    yield* tasks
      .upsert(nextTask)
      .pipe(Effect.mapError(toTaskBoardError("Failed to move project task.")));
    return nextTask;
  });

  const reorderTasks: TaskBoardShape["reorderTasks"] = Effect.fn("TaskBoard.reorderTasks")(
    function* (input) {
      const projectTasks = yield* tasks
        .listByProject({ projectId: input.projectId })
        .pipe(Effect.mapError(toTaskBoardError("Failed to list project tasks.")));
      const columnTasks = projectTasks.filter((task) => task.columnKey === input.columnKey);
      const tasksById = new Map(columnTasks.map((task) => [task.id, task]));

      for (const taskId of input.orderedTaskIds) {
        const task = tasksById.get(taskId);
        if (!task) {
          return yield* new ProjectTaskNotFoundError({ taskId });
        }
      }

      const orderedIdSet = new Set(input.orderedTaskIds);
      const orderedTasks = input.orderedTaskIds
        .map((taskId) => tasksById.get(taskId))
        .filter((task): task is ProjectTask => task !== undefined);
      const remainingTasks = columnTasks.filter((task) => !orderedIdSet.has(task.id));
      const nextUpdatedAt = yield* nowIso;
      const reordered = [...orderedTasks, ...remainingTasks].map(
        (task, index) =>
          Object.assign({}, task, {
            column: COLUMN_LABEL_BY_KEY.get(input.columnKey) ?? task.column,
            columnKey: input.columnKey,
            sortOrder: index,
            updatedAt: nextUpdatedAt,
          }) satisfies ProjectTask,
      );

      for (const task of reordered) {
        yield* tasks
          .upsert(task)
          .pipe(Effect.mapError(toTaskBoardError("Failed to reorder project tasks.")));
      }

      return reordered;
    },
  );

  const listRuns: TaskBoardShape["listRuns"] = Effect.fn("TaskBoard.listRuns")(
    function* (projectId) {
      return yield* runs
        .listByProject({ projectId })
        .pipe(Effect.mapError(toTaskBoardError("Failed to list task runs.")));
    },
  );

  const resolveRunnableTaskExecutionProvider = Effect.fn(
    "TaskBoard.resolveRunnableTaskExecutionProvider",
  )(function* (instanceId?: ProviderInstanceId) {
    const providers = yield* providerRegistry.getProviders.pipe(
      Effect.mapError(toTaskBoardError("Failed to read provider execution capability.")),
    );

    if (instanceId) {
      const requested = providers.find((provider) => provider.instanceId === instanceId);
      if (!requested) {
        return yield* new ProjectTaskBoardError({
          message: `Unknown provider instance: ${instanceId}`,
        });
      }
      const capability = getProviderTaskExecution(requested);
      if (!capability.runnable) {
        return yield* new ProjectTaskBoardError({
          message: capability.reason ?? "Selected provider cannot run background tasks.",
        });
      }
      return requested.instanceId;
    }

    const runnable = providers.find((provider) => getProviderTaskExecution(provider).runnable);
    if (!runnable) {
      return yield* new ProjectTaskBoardError({
        message: "No runnable provider is available for background task execution.",
      });
    }
    return runnable.instanceId;
  });

  const nextRunAttempt = Effect.fn("TaskBoard.nextRunAttempt")(function* (taskId: TaskId) {
    const taskRuns = yield* runs
      .listByTask({ taskId })
      .pipe(Effect.mapError(toTaskBoardError("Failed to list task runs.")));
    return taskRuns.reduce((max, run) => Math.max(max, run.attempt), 0) + 1;
  });

  const assertTaskCanQueueRun = Effect.fn("TaskBoard.assertTaskCanQueueRun")(function* (
    task: ProjectTask,
  ) {
    if (task.activeRunId !== null || ACTIVE_TASK_RUN_STATUSES.includes(task.runStatus)) {
      return yield* new ProjectTaskBoardError({
        message: `Task ${task.identifier} already has an active run.`,
      });
    }
  });

  const startRun: TaskBoardShape["startRun"] = Effect.fn("TaskBoard.startRun")(function* (input) {
    const task = yield* getTask(input.taskId);
    yield* assertTaskCanQueueRun(task);
    yield* resolveRunnableTaskExecutionProvider(input.instanceId);

    const updatedAt = yield* nowIso;
    const run: ProjectTaskRun = {
      id: TaskRunId.make(crypto.randomUUID()),
      taskId: task.id,
      projectId: task.projectId,
      status: "queued",
      attempt: yield* nextRunAttempt(task.id),
      workspacePath: task.workspacePath,
      latestActivity: "Queued for background execution.",
      lastError: null,
      startedAt: null,
      updatedAt,
      finishedAt: null,
      runtimeMs: null,
      tokenUsage: null,
      artifacts: [],
      verification: null,
    };

    yield* runs.upsert(run).pipe(Effect.mapError(toTaskBoardError("Failed to store task run.")));
    yield* tasks
      .upsert({
        ...task,
        runStatus: "queued",
        activeRunId: run.id,
        latestActivity: "Queued for background execution.",
        lastError: null,
        updatedAt,
      })
      .pipe(Effect.mapError(toTaskBoardError("Failed to update project task run state.")));
    yield* taskRunExecutor.enqueueRun({
      runId: run.id,
      instanceId: input.instanceId,
    });

    return run;
  });

  const stopRun: TaskBoardShape["stopRun"] = Effect.fn("TaskBoard.stopRun")(function* (input) {
    const task = yield* getTask(input.taskId);
    if (task.activeRunId === null) {
      return yield* new ProjectTaskBoardError({
        message: `Task ${task.identifier} does not have an active run to stop.`,
      });
    }

    const activeRun = yield* runs
      .getById({ runId: task.activeRunId })
      .pipe(Effect.mapError(toTaskBoardError("Failed to read active task run.")));
    if (Option.isNone(activeRun)) {
      return yield* new ProjectTaskBoardError({
        message: `Active run ${task.activeRunId} could not be found.`,
      });
    }

    const finishedAt = yield* nowIso;
    const canceledRun: ProjectTaskRun = {
      ...activeRun.value,
      status: "canceled",
      latestActivity: "Canceled by operator.",
      lastError: null,
      finishedAt,
      updatedAt: finishedAt,
    };

    yield* runs
      .upsert(canceledRun)
      .pipe(Effect.mapError(toTaskBoardError("Failed to store canceled task run.")));
    yield* tasks
      .upsert({
        ...task,
        runStatus: "canceled",
        activeRunId: null,
        latestActivity: "Canceled by operator.",
        lastError: null,
        updatedAt: finishedAt,
      })
      .pipe(Effect.mapError(toTaskBoardError("Failed to update project task run state.")));
    yield* taskRunExecutor.cancelRun(task.activeRunId);

    return canceledRun;
  });

  const retryRun: TaskBoardShape["retryRun"] = Effect.fn("TaskBoard.retryRun")(function* (input) {
    const task = yield* getTask(input.taskId);
    yield* assertTaskCanQueueRun(task);
    yield* resolveRunnableTaskExecutionProvider(input.instanceId);

    const updatedAt = yield* nowIso;
    const run: ProjectTaskRun = {
      id: TaskRunId.make(crypto.randomUUID()),
      taskId: task.id,
      projectId: task.projectId,
      status: "retrying",
      attempt: yield* nextRunAttempt(task.id),
      workspacePath: task.workspacePath,
      latestActivity: "Queued for retry.",
      lastError: null,
      startedAt: null,
      updatedAt,
      finishedAt: null,
      runtimeMs: null,
      tokenUsage: null,
      artifacts: [],
      verification: null,
    };

    yield* runs.upsert(run).pipe(Effect.mapError(toTaskBoardError("Failed to store task run.")));
    yield* tasks
      .upsert({
        ...task,
        runStatus: "retrying",
        activeRunId: run.id,
        latestActivity: "Queued for retry.",
        lastError: null,
        updatedAt,
      })
      .pipe(Effect.mapError(toTaskBoardError("Failed to update project task run state.")));
    yield* taskRunExecutor.enqueueRun({
      runId: run.id,
      instanceId: input.instanceId,
    });

    return run;
  });

  const upsertRun: TaskBoardShape["upsertRun"] = Effect.fn("TaskBoard.upsertRun")(function* (run) {
    yield* runs.upsert(run).pipe(Effect.mapError(toTaskBoardError("Failed to store task run.")));
    return run;
  });

  return TaskBoard.of({
    getBoard,
    getTask,
    createTask,
    updateTask,
    moveTask,
    reorderTasks,
    listRuns,
    startRun,
    stopRun,
    retryRun,
    upsertRun,
  });
});

export const TaskBoardLive = Layer.effect(TaskBoard, makeTaskBoard);
