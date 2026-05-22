import { EnvironmentId, ProjectId, type EnvironmentApi } from "@t3tools/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProjectTaskMutationOptions,
  moveProjectTaskMutationOptions,
  projectTaskAssistantMutationOptions,
  projectTaskBoardQueryOptions,
  projectTaskQueryOptions,
  projectTaskRunsQueryOptions,
  reorderProjectTasksMutationOptions,
  retryProjectTaskRunMutationOptions,
  startProjectTaskRunMutationOptions,
  stopProjectTaskRunMutationOptions,
  taskBoardQueryKeys,
  updateProjectTaskMutationOptions,
} from "./taskBoardReactQuery";
import * as environmentApi from "../environmentApi";
import { TaskId } from "@t3tools/contracts";

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-board");

function mockEnvironmentApi(input: {
  getBoard: ReturnType<typeof vi.fn>;
  getTask: ReturnType<typeof vi.fn>;
  listRuns: ReturnType<typeof vi.fn>;
  createTask?: ReturnType<typeof vi.fn>;
  updateTask?: ReturnType<typeof vi.fn>;
  moveTask?: ReturnType<typeof vi.fn>;
  reorderTasks?: ReturnType<typeof vi.fn>;
  startRun?: ReturnType<typeof vi.fn>;
  stopRun?: ReturnType<typeof vi.fn>;
  retryRun?: ReturnType<typeof vi.fn>;
  assistantRespond?: ReturnType<typeof vi.fn>;
}) {
  vi.spyOn(environmentApi, "ensureEnvironmentApi").mockReturnValue({
    projectTasks: {
      getBoard: input.getBoard,
      getTask: input.getTask,
      listRuns: input.listRuns,
      createTask: input.createTask ?? vi.fn(),
      updateTask: input.updateTask ?? vi.fn(),
      moveTask: input.moveTask ?? vi.fn(),
      reorderTasks: input.reorderTasks ?? vi.fn(),
      startRun: input.startRun ?? vi.fn(),
      stopRun: input.stopRun ?? vi.fn(),
      retryRun: input.retryRun ?? vi.fn(),
      assistantRespond: input.assistantRespond ?? vi.fn(),
    },
  } as unknown as EnvironmentApi);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("taskBoardQueryKeys", () => {
  it("separates board cache entries by environment and project", () => {
    expect(taskBoardQueryKeys.board(environmentId, projectId)).not.toEqual(
      taskBoardQueryKeys.board(environmentId, ProjectId.make("project-other")),
    );
  });
});

describe("projectTaskBoardQueryOptions", () => {
  it("loads board state through the environment task API", async () => {
    const getBoard = vi.fn().mockResolvedValue({
      projectId,
      columns: [],
      activeRunCount: 0,
      updatedAt: "2026-05-20T00:00:00.000Z",
    });
    const getTask = vi.fn();
    const listRuns = vi.fn().mockResolvedValue([]);
    mockEnvironmentApi({ getBoard, getTask, listRuns });

    const queryClient = new QueryClient();
    await queryClient.fetchQuery(
      projectTaskBoardQueryOptions({
        environmentId,
        projectId,
      }),
    );

    expect(getBoard).toHaveBeenCalledWith({ projectId });
    expect(getTask).not.toHaveBeenCalled();
    expect(listRuns).not.toHaveBeenCalled();
  });
});

describe("projectTaskQueryOptions", () => {
  it("loads task state through the environment task API", async () => {
    const getBoard = vi.fn();
    const getTask = vi.fn().mockResolvedValue({
      id: TaskId.make("task-1"),
      projectId,
      identifier: "ABC-123",
      title: "Ship board view",
      description: null,
      column: "Todo",
      columnKey: "todo",
      priority: "high",
      labels: [],
      blockedBy: [],
      sortOrder: 0,
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T01:00:00.000Z",
      runStatus: "queued",
      activeRunId: null,
      workspacePath: null,
      latestActivity: null,
      lastError: null,
    });
    const listRuns = vi.fn();
    mockEnvironmentApi({ getBoard, getTask, listRuns });

    const queryClient = new QueryClient();
    await queryClient.fetchQuery(
      projectTaskQueryOptions({
        environmentId,
        taskId: TaskId.make("task-1"),
      }),
    );

    expect(getTask).toHaveBeenCalledWith({ taskId: TaskId.make("task-1") });
    expect(getBoard).not.toHaveBeenCalled();
    expect(listRuns).not.toHaveBeenCalled();
  });
});

describe("task board mutations", () => {
  it("invalidates board and task queries after creating a task", async () => {
    const createTask = vi.fn().mockResolvedValue({
      id: TaskId.make("task-1"),
      projectId,
      identifier: "ABC-123",
      title: "Ship board view",
      description: null,
      column: "Todo",
      columnKey: "todo",
      priority: "high",
      labels: [],
      blockedBy: [],
      sortOrder: 0,
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T01:00:00.000Z",
      runStatus: "idle",
      activeRunId: null,
      workspacePath: null,
      latestActivity: null,
      lastError: null,
    });
    mockEnvironmentApi({
      getBoard: vi.fn(),
      getTask: vi.fn(),
      listRuns: vi.fn(),
      createTask,
    });

    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const mutation = createProjectTaskMutationOptions({
      environmentId,
      projectId,
      queryClient,
    });

    const mutationFn = mutation.mutationFn;
    if (!mutationFn) {
      throw new Error("Expected create task mutation function.");
    }
    const created = await mutationFn(
      {
        projectId,
        identifier: "ABC-123",
        title: "Ship board view",
        description: null,
        column: "Todo",
        columnKey: "todo",
        priority: "high",
        labels: [],
        blockedBy: [],
      },
      {} as never,
    );
    await mutation.onSuccess?.(created, undefined as never, undefined as never, undefined as never);

    expect(createTask).toHaveBeenCalledWith({
      projectId,
      identifier: "ABC-123",
      title: "Ship board view",
      description: null,
      column: "Todo",
      columnKey: "todo",
      priority: "high",
      labels: [],
      blockedBy: [],
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it("calls task update, move, and reorder methods", async () => {
    const updateTask = vi.fn().mockResolvedValue({
      id: TaskId.make("task-1"),
      projectId,
      identifier: "ABC-123",
      title: "Updated",
      description: null,
      column: "Todo",
      columnKey: "todo",
      priority: "medium",
      labels: [],
      blockedBy: [],
      sortOrder: 1,
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T02:00:00.000Z",
      runStatus: "idle",
      activeRunId: null,
      workspacePath: null,
      latestActivity: null,
      lastError: null,
    });
    const moveTask = vi.fn().mockResolvedValue({
      id: TaskId.make("task-1"),
      projectId,
      identifier: "ABC-123",
      title: "Updated",
      description: null,
      column: "In Progress",
      columnKey: "in_progress",
      priority: "medium",
      labels: [],
      blockedBy: [],
      sortOrder: 2,
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T02:00:00.000Z",
      runStatus: "idle",
      activeRunId: null,
      workspacePath: null,
      latestActivity: null,
      lastError: null,
    });
    const reorderTasks = vi.fn().mockResolvedValue([]);
    mockEnvironmentApi({
      getBoard: vi.fn(),
      getTask: vi.fn(),
      listRuns: vi.fn(),
      updateTask,
      moveTask,
      reorderTasks,
    });

    const queryClient = new QueryClient();
    const updateMutation = updateProjectTaskMutationOptions({
      environmentId,
      projectId,
      queryClient,
    });
    const updateMutationFn = updateMutation.mutationFn;
    if (!updateMutationFn) {
      throw new Error("Expected update task mutation function.");
    }
    await updateMutationFn(
      {
        taskId: TaskId.make("task-1"),
        identifier: "ABC-123",
        title: "Updated",
        description: null,
        priority: "medium",
        labels: [],
        blockedBy: [],
      },
      {} as never,
    );

    const moveMutation = moveProjectTaskMutationOptions({ environmentId, projectId, queryClient });
    const moveMutationFn = moveMutation.mutationFn;
    if (!moveMutationFn) {
      throw new Error("Expected move task mutation function.");
    }
    await moveMutationFn(
      {
        taskId: TaskId.make("task-1"),
        column: "In Progress",
        columnKey: "in_progress",
      },
      {} as never,
    );

    const reorderMutation = reorderProjectTasksMutationOptions({
      environmentId,
      projectId,
      queryClient,
    });
    const reorderMutationFn = reorderMutation.mutationFn;
    if (!reorderMutationFn) {
      throw new Error("Expected reorder task mutation function.");
    }
    await reorderMutationFn(
      {
        projectId,
        columnKey: "todo",
        orderedTaskIds: [TaskId.make("task-1")],
      },
      {} as never,
    );

    expect(updateTask).toHaveBeenCalledOnce();
    expect(moveTask).toHaveBeenCalledOnce();
    expect(reorderTasks).toHaveBeenCalledOnce();
  });

  it("calls task start, stop, and retry run methods", async () => {
    const startRun = vi.fn().mockResolvedValue({
      id: "run-1",
      taskId: TaskId.make("task-1"),
      projectId,
      status: "queued",
      attempt: 1,
      workspacePath: null,
      latestActivity: "Queued",
      lastError: null,
      startedAt: null,
      updatedAt: "2026-05-20T02:00:00.000Z",
      finishedAt: null,
      runtimeMs: null,
      tokenUsage: null,
      artifacts: [],
      verification: null,
    });
    const stopRun = vi.fn().mockResolvedValue({
      id: "run-1",
      taskId: TaskId.make("task-1"),
      projectId,
      status: "canceled",
      attempt: 1,
      workspacePath: null,
      latestActivity: "Canceled",
      lastError: null,
      startedAt: null,
      updatedAt: "2026-05-20T02:01:00.000Z",
      finishedAt: "2026-05-20T02:01:00.000Z",
      runtimeMs: null,
      tokenUsage: null,
      artifacts: [],
      verification: null,
    });
    const retryRun = vi.fn().mockResolvedValue({
      id: "run-2",
      taskId: TaskId.make("task-1"),
      projectId,
      status: "retrying",
      attempt: 2,
      workspacePath: null,
      latestActivity: "Retry queued",
      lastError: null,
      startedAt: null,
      updatedAt: "2026-05-20T02:02:00.000Z",
      finishedAt: null,
      runtimeMs: null,
      tokenUsage: null,
      artifacts: [],
      verification: null,
    });
    mockEnvironmentApi({
      getBoard: vi.fn(),
      getTask: vi.fn(),
      listRuns: vi.fn(),
      startRun,
      stopRun,
      retryRun,
    });

    const queryClient = new QueryClient();
    const startMutation = startProjectTaskRunMutationOptions({
      environmentId,
      projectId,
      queryClient,
    });
    const startMutationFn = startMutation.mutationFn;
    if (!startMutationFn) throw new Error("Expected start run mutation function.");
    await startMutationFn({ taskId: TaskId.make("task-1") }, {} as never);

    const stopMutation = stopProjectTaskRunMutationOptions({
      environmentId,
      projectId,
      queryClient,
    });
    const stopMutationFn = stopMutation.mutationFn;
    if (!stopMutationFn) throw new Error("Expected stop run mutation function.");
    await stopMutationFn({ taskId: TaskId.make("task-1") }, {} as never);

    const retryMutation = retryProjectTaskRunMutationOptions({
      environmentId,
      projectId,
      queryClient,
    });
    const retryMutationFn = retryMutation.mutationFn;
    if (!retryMutationFn) throw new Error("Expected retry run mutation function.");
    await retryMutationFn({ taskId: TaskId.make("task-1") }, {} as never);

    expect(startRun).toHaveBeenCalledOnce();
    expect(stopRun).toHaveBeenCalledOnce();
    expect(retryRun).toHaveBeenCalledOnce();
  });

  it("routes assistant messages through the task assistant API", async () => {
    const assistantRespond = vi.fn().mockResolvedValue({
      reply: "Created task ABC-124 in Todo.",
      toolCalls: [{ toolName: "create_task", summary: "Created task ABC-124 in Todo." }],
    });
    mockEnvironmentApi({
      getBoard: vi.fn(),
      getTask: vi.fn(),
      listRuns: vi.fn(),
      assistantRespond,
    });

    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const mutation = projectTaskAssistantMutationOptions({
      environmentId,
      projectId,
      queryClient,
    });
    const mutationFn = mutation.mutationFn;
    if (!mutationFn) throw new Error("Expected assistant mutation function.");

    const payload = {
      projectId,
      message: "create task ABC-124: Add assistant sidebar in Todo",
    };
    const response = await mutationFn(payload, {} as never);
    await mutation.onSuccess?.(response, payload, undefined as never, undefined as never);

    expect(assistantRespond).toHaveBeenCalledWith(payload);
    expect(invalidateQueries).toHaveBeenCalled();
  });
});

describe("projectTaskRunsQueryOptions", () => {
  it("loads project run state through the environment task API", async () => {
    const getBoard = vi.fn();
    const getTask = vi.fn();
    const listRuns = vi.fn().mockResolvedValue([]);
    mockEnvironmentApi({ getBoard, getTask, listRuns });

    const queryClient = new QueryClient();
    await queryClient.fetchQuery(
      projectTaskRunsQueryOptions({
        environmentId,
        projectId,
      }),
    );

    expect(listRuns).toHaveBeenCalledWith({ projectId });
    expect(getBoard).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
  });
});
