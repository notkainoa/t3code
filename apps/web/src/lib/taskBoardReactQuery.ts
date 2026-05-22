import type {
  CreateProjectTaskInput,
  EnvironmentId,
  MoveProjectTaskInput,
  ProjectTaskAssistantRequest,
  ProjectId,
  ReorderProjectTasksInput,
  RetryProjectTaskRunInput,
  StartProjectTaskRunInput,
  StopProjectTaskRunInput,
  TaskId,
  UpdateProjectTaskInput,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "../environmentApi";

export const taskBoardQueryKeys = {
  all: ["task-board"] as const,
  board: (environmentId: EnvironmentId | null, projectId: ProjectId | null) =>
    ["task-board", "board", environmentId ?? null, projectId ?? null] as const,
  task: (environmentId: EnvironmentId | null, taskId: TaskId | null) =>
    ["task-board", "task", environmentId ?? null, taskId ?? null] as const,
  runs: (environmentId: EnvironmentId | null, projectId: ProjectId | null) =>
    ["task-board", "runs", environmentId ?? null, projectId ?? null] as const,
};

async function invalidateTaskBoardQueries(input: {
  queryClient: QueryClient;
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  taskId?: TaskId | null | undefined;
}) {
  await Promise.all([
    input.queryClient.invalidateQueries({
      queryKey: taskBoardQueryKeys.board(input.environmentId, input.projectId),
    }),
    input.projectId === null
      ? Promise.resolve()
      : input.queryClient.invalidateQueries({
          queryKey: taskBoardQueryKeys.runs(input.environmentId, input.projectId),
        }),
    input.taskId == null
      ? Promise.resolve()
      : input.queryClient.invalidateQueries({
          queryKey: taskBoardQueryKeys.task(input.environmentId, input.taskId),
        }),
  ]);
}

export function projectTaskBoardQueryOptions(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: taskBoardQueryKeys.board(input.environmentId, input.projectId),
    queryFn: async () => {
      if (!input.environmentId || !input.projectId) {
        throw new Error("Project task board is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).projectTasks.getBoard({
        projectId: input.projectId,
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.projectId !== null,
    staleTime: input.staleTime ?? 5_000,
  });
}

export function projectTaskRunsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: taskBoardQueryKeys.runs(input.environmentId, input.projectId),
    queryFn: async () => {
      if (!input.environmentId || !input.projectId) {
        throw new Error("Project task runs are unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).projectTasks.listRuns({
        projectId: input.projectId,
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.projectId !== null,
    staleTime: input.staleTime ?? 5_000,
  });
}

export function projectTaskQueryOptions(input: {
  environmentId: EnvironmentId | null;
  taskId: TaskId | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: taskBoardQueryKeys.task(input.environmentId, input.taskId),
    queryFn: async () => {
      if (!input.environmentId || !input.taskId) {
        throw new Error("Project task is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).projectTasks.getTask({
        taskId: input.taskId,
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.taskId !== null,
    staleTime: input.staleTime ?? 5_000,
  });
}

export function createProjectTaskMutationOptions(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: [
      "task-board",
      "mutation",
      "create",
      input.environmentId ?? null,
      input.projectId ?? null,
    ],
    mutationFn: async (payload: CreateProjectTaskInput) => {
      if (!input.environmentId) {
        throw new Error("Project task creation is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).projectTasks.createTask(payload);
    },
    onSuccess: async (task) => {
      await invalidateTaskBoardQueries({
        queryClient: input.queryClient,
        environmentId: input.environmentId,
        projectId: task.projectId,
        taskId: task.id,
      });
    },
  });
}

export function updateProjectTaskMutationOptions(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: [
      "task-board",
      "mutation",
      "update",
      input.environmentId ?? null,
      input.projectId ?? null,
    ],
    mutationFn: async (payload: UpdateProjectTaskInput) => {
      if (!input.environmentId) {
        throw new Error("Project task update is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).projectTasks.updateTask(payload);
    },
    onSuccess: async (task) => {
      await invalidateTaskBoardQueries({
        queryClient: input.queryClient,
        environmentId: input.environmentId,
        projectId: task.projectId,
        taskId: task.id,
      });
    },
  });
}

export function moveProjectTaskMutationOptions(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: [
      "task-board",
      "mutation",
      "move",
      input.environmentId ?? null,
      input.projectId ?? null,
    ],
    mutationFn: async (payload: MoveProjectTaskInput) => {
      if (!input.environmentId) {
        throw new Error("Project task move is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).projectTasks.moveTask(payload);
    },
    onSuccess: async (task) => {
      await invalidateTaskBoardQueries({
        queryClient: input.queryClient,
        environmentId: input.environmentId,
        projectId: task.projectId,
        taskId: task.id,
      });
    },
  });
}

export function reorderProjectTasksMutationOptions(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: [
      "task-board",
      "mutation",
      "reorder",
      input.environmentId ?? null,
      input.projectId ?? null,
    ],
    mutationFn: async (payload: ReorderProjectTasksInput) => {
      if (!input.environmentId) {
        throw new Error("Project task reorder is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).projectTasks.reorderTasks(payload);
    },
    onSuccess: async (_, payload) => {
      await invalidateTaskBoardQueries({
        queryClient: input.queryClient,
        environmentId: input.environmentId,
        projectId: payload.projectId,
      });
    },
  });
}

export function startProjectTaskRunMutationOptions(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: [
      "task-board",
      "mutation",
      "start-run",
      input.environmentId ?? null,
      input.projectId ?? null,
    ],
    mutationFn: async (payload: StartProjectTaskRunInput) => {
      if (!input.environmentId) {
        throw new Error("Project task start is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).projectTasks.startRun(payload);
    },
    onSuccess: async (run) => {
      await invalidateTaskBoardQueries({
        queryClient: input.queryClient,
        environmentId: input.environmentId,
        projectId: run.projectId,
        taskId: run.taskId,
      });
    },
  });
}

export function stopProjectTaskRunMutationOptions(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: [
      "task-board",
      "mutation",
      "stop-run",
      input.environmentId ?? null,
      input.projectId ?? null,
    ],
    mutationFn: async (payload: StopProjectTaskRunInput) => {
      if (!input.environmentId) {
        throw new Error("Project task stop is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).projectTasks.stopRun(payload);
    },
    onSuccess: async (run) => {
      await invalidateTaskBoardQueries({
        queryClient: input.queryClient,
        environmentId: input.environmentId,
        projectId: run.projectId,
        taskId: run.taskId,
      });
    },
  });
}

export function retryProjectTaskRunMutationOptions(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: [
      "task-board",
      "mutation",
      "retry-run",
      input.environmentId ?? null,
      input.projectId ?? null,
    ],
    mutationFn: async (payload: RetryProjectTaskRunInput) => {
      if (!input.environmentId) {
        throw new Error("Project task retry is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).projectTasks.retryRun(payload);
    },
    onSuccess: async (run) => {
      await invalidateTaskBoardQueries({
        queryClient: input.queryClient,
        environmentId: input.environmentId,
        projectId: run.projectId,
        taskId: run.taskId,
      });
    },
  });
}

export function projectTaskAssistantMutationOptions(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: [
      "task-board",
      "mutation",
      "assistant-respond",
      input.environmentId ?? null,
      input.projectId ?? null,
    ],
    mutationFn: async (payload: ProjectTaskAssistantRequest) => {
      if (!input.environmentId) {
        throw new Error("Project task assistant is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).projectTasks.assistantRespond(payload);
    },
    onSuccess: async (_, payload) => {
      await invalidateTaskBoardQueries({
        queryClient: input.queryClient,
        environmentId: input.environmentId,
        projectId: payload.projectId,
      });
    },
  });
}
