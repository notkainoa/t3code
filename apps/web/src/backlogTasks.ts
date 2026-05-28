import {
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ServerProvider,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { truncate } from "@t3tools/shared/String";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useComposerDraftStore, type DraftId } from "./composerDraftStore";
import { readEnvironmentApi } from "./environmentApi";
import { appendTerminalContextsToPrompt, type TerminalContextDraft } from "./lib/terminalContext";
import { newCommandId, newMessageId, randomUUID } from "./lib/utils";
import { createMemoryStorage } from "./lib/storage";
import { selectProjectByRef, useStore } from "./store";
import {
  deriveComposerSendState,
  formatOutgoingPrompt,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  readFileAsDataUrl,
} from "./components/ChatView.logic";

export const BacklogTaskId = Schema.String.pipe(Schema.brand("BacklogTaskId"));
export type BacklogTaskId = typeof BacklogTaskId.Type;

const BACKLOG_TASK_STORAGE_KEY = "t3code:backlog-tasks:v1";
const BACKLOG_TASK_STORAGE_VERSION = 1;

export interface BacklogTask {
  id: BacklogTaskId;
  projectKey: string;
  draftId: DraftId;
  title: string;
  createdAt: string;
  updatedAt: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  modelSelection: ModelSelection;
  providerDriver: ProviderDriverKind;
  promptEffort: string | null;
}

interface BacklogTaskStoreState {
  tasksById: Record<string, BacklogTask>;
  taskIdsByProjectKey: Record<string, string[]>;
  upsertTask: (task: BacklogTask) => void;
  deleteTask: (taskId: BacklogTaskId) => void;
}

export function newBacklogTaskId(): BacklogTaskId {
  return BacklogTaskId.make(randomUUID());
}

export function deriveBacklogTaskTitle(prompt: string): string {
  const firstLine = prompt
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return truncate(firstLine || "Untitled task");
}

function removeTaskId(ids: readonly string[], taskId: string): string[] {
  return ids.filter((id) => id !== taskId);
}

function normalizeBacklogTask(value: unknown): BacklogTask | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<BacklogTask>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.projectKey !== "string" ||
    typeof candidate.draftId !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.runtimeMode !== "string" ||
    typeof candidate.interactionMode !== "string" ||
    typeof candidate.providerDriver !== "string" ||
    !candidate.modelSelection ||
    typeof candidate.modelSelection !== "object" ||
    typeof candidate.modelSelection.instanceId !== "string" ||
    typeof candidate.modelSelection.model !== "string"
  ) {
    return null;
  }
  return {
    id: BacklogTaskId.make(candidate.id),
    projectKey: candidate.projectKey,
    draftId: candidate.draftId,
    title: candidate.title,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    runtimeMode: candidate.runtimeMode as RuntimeMode,
    interactionMode: candidate.interactionMode as ProviderInteractionMode,
    modelSelection: candidate.modelSelection as ModelSelection,
    providerDriver: candidate.providerDriver as ProviderDriverKind,
    promptEffort:
      typeof candidate.promptEffort === "string" && candidate.promptEffort.length > 0
        ? candidate.promptEffort
        : null,
  };
}

function normalizePersistedState(
  value: unknown,
): Pick<BacklogTaskStoreState, "tasksById" | "taskIdsByProjectKey"> {
  if (!value || typeof value !== "object") {
    return { tasksById: {}, taskIdsByProjectKey: {} };
  }
  const candidate = value as Partial<BacklogTaskStoreState>;
  const tasksById: Record<string, BacklogTask> = {};
  if (candidate.tasksById && typeof candidate.tasksById === "object") {
    for (const [taskId, taskValue] of Object.entries(candidate.tasksById)) {
      const task = normalizeBacklogTask(taskValue);
      if (task && task.id === taskId) {
        tasksById[taskId] = task;
      }
    }
  }

  const taskIdsByProjectKey: Record<string, string[]> = {};
  if (candidate.taskIdsByProjectKey && typeof candidate.taskIdsByProjectKey === "object") {
    for (const [projectKey, ids] of Object.entries(candidate.taskIdsByProjectKey)) {
      if (!Array.isArray(ids)) {
        continue;
      }
      const seen = new Set<string>();
      const normalizedIds = ids.filter((id): id is string => {
        if (typeof id !== "string" || seen.has(id) || !tasksById[id]) {
          return false;
        }
        seen.add(id);
        return true;
      });
      if (normalizedIds.length > 0) {
        taskIdsByProjectKey[projectKey] = normalizedIds;
      }
    }
  }

  for (const task of Object.values(tasksById)) {
    const ids = taskIdsByProjectKey[task.projectKey] ?? [];
    if (!ids.includes(task.id)) {
      taskIdsByProjectKey[task.projectKey] = [...ids, task.id];
    }
  }

  return { tasksById, taskIdsByProjectKey };
}

export const useBacklogTaskStore = create<BacklogTaskStoreState>()(
  persist(
    (set) => ({
      tasksById: {},
      taskIdsByProjectKey: {},
      upsertTask: (task) => {
        set((state) => {
          const previousTask = state.tasksById[task.id];
          const nextTaskIdsByProjectKey = { ...state.taskIdsByProjectKey };
          if (previousTask && previousTask.projectKey !== task.projectKey) {
            const previousIds = removeTaskId(
              nextTaskIdsByProjectKey[previousTask.projectKey] ?? [],
              task.id,
            );
            if (previousIds.length > 0) {
              nextTaskIdsByProjectKey[previousTask.projectKey] = previousIds;
            } else {
              delete nextTaskIdsByProjectKey[previousTask.projectKey];
            }
          }
          const projectIds = removeTaskId(nextTaskIdsByProjectKey[task.projectKey] ?? [], task.id);
          nextTaskIdsByProjectKey[task.projectKey] = [...projectIds, task.id];
          return {
            tasksById: {
              ...state.tasksById,
              [task.id]: task,
            },
            taskIdsByProjectKey: nextTaskIdsByProjectKey,
          };
        });
      },
      deleteTask: (taskId) => {
        set((state) => {
          if (!state.tasksById[taskId]) {
            return state;
          }
          const { [taskId]: _removedTask, ...tasksById } = state.tasksById;
          const taskIdsByProjectKey = Object.fromEntries(
            Object.entries(state.taskIdsByProjectKey).flatMap(([projectKey, ids]) => {
              const nextIds = removeTaskId(ids, taskId);
              return nextIds.length > 0 ? [[projectKey, nextIds]] : [];
            }),
          ) as Record<string, string[]>;
          return { tasksById, taskIdsByProjectKey };
        });
      },
    }),
    {
      name: BACKLOG_TASK_STORAGE_KEY,
      version: BACKLOG_TASK_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
      ),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedState(persistedState),
      }),
      partialize: (state) => ({
        tasksById: state.tasksById,
        taskIdsByProjectKey: state.taskIdsByProjectKey,
      }),
    },
  ),
);

function resolveBacklogTaskProject(task: BacklogTask) {
  const draftSession = useComposerDraftStore.getState().getDraftSession(task.draftId);
  if (!draftSession) {
    throw new Error("This backlog task no longer has a saved draft.");
  }
  const projectRef = scopeProjectRef(draftSession.environmentId, draftSession.projectId);
  const project = selectProjectByRef(useStore.getState(), projectRef);
  if (!project) {
    throw new Error("This backlog task's project is no longer available.");
  }
  return { draftSession, project };
}

function resolveBacklogTaskPrompt(input: {
  prompt: string;
  terminalContexts: readonly TerminalContextDraft[];
}): {
  trimmedPrompt: string;
  messageText: string;
  sendableTerminalContexts: TerminalContextDraft[];
} {
  const sendState = deriveComposerSendState({
    prompt: input.prompt,
    imageCount: 0,
    terminalContexts: input.terminalContexts,
  });
  if (sendState.trimmedPrompt.length === 0) {
    throw new Error("Add a prompt before starting this backlog task.");
  }
  return {
    trimmedPrompt: sendState.trimmedPrompt,
    messageText: appendTerminalContextsToPrompt(input.prompt, sendState.sendableTerminalContexts),
    sendableTerminalContexts: sendState.sendableTerminalContexts,
  };
}

export async function startBacklogTask(input: {
  taskId: BacklogTaskId;
  providerStatuses: ReadonlyArray<ServerProvider>;
  providerStatusesByEnvironmentId?: Readonly<Record<string, ReadonlyArray<ServerProvider>>>;
}): Promise<{ environmentId: string; threadId: string }> {
  const task = useBacklogTaskStore.getState().tasksById[input.taskId];
  if (!task) {
    throw new Error("This backlog task no longer exists.");
  }
  const draft = useComposerDraftStore.getState().getComposerDraft(task.draftId);
  if (!draft) {
    throw new Error("This backlog task no longer has saved composer content.");
  }
  const { draftSession, project } = resolveBacklogTaskProject(task);
  const providerStatuses =
    input.providerStatusesByEnvironmentId?.[draftSession.environmentId] ?? input.providerStatuses;
  const api = readEnvironmentApi(draftSession.environmentId);
  if (!api) {
    throw new Error("The target environment is not connected.");
  }

  const { trimmedPrompt, messageText } = resolveBacklogTaskPrompt({
    prompt: draft.prompt,
    terminalContexts: draft.terminalContexts,
  });
  const providerSnapshot = providerStatuses.find(
    (provider) => provider.instanceId === task.modelSelection.instanceId,
  );
  const providerDriver = providerSnapshot?.driver ?? task.providerDriver;
  const modelSelection = task.modelSelection;
  const title = deriveBacklogTaskTitle(task.title || trimmedPrompt);
  const messageId = newMessageId();
  const createdAt = new Date().toISOString();
  const attachments = await Promise.all(
    draft.images.map(async (image) => ({
      type: "image" as const,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: await readFileAsDataUrl(image.file),
    })),
  );
  const outgoingText = formatOutgoingPrompt({
    provider: providerDriver,
    model: modelSelection.model,
    models: providerSnapshot?.models ?? [],
    effort: task.promptEffort,
    text: messageText || IMAGE_ONLY_BOOTSTRAP_PROMPT,
  });
  const shouldCreateWorktree = draftSession.envMode === "worktree" && !draftSession.worktreePath;
  if (shouldCreateWorktree && !draftSession.branch) {
    throw new Error("Select a base branch before starting this backlog task in a new worktree.");
  }

  const threadId = draftSession.threadId;
  await api.orchestration.dispatchCommand({
    type: "thread.turn.start",
    commandId: newCommandId(),
    threadId,
    message: {
      messageId,
      role: "user",
      text: outgoingText,
      attachments,
    },
    modelSelection,
    titleSeed: title,
    runtimeMode: task.runtimeMode,
    interactionMode: task.interactionMode,
    bootstrap: {
      createThread: {
        projectId: project.id,
        title,
        modelSelection,
        runtimeMode: task.runtimeMode,
        interactionMode: task.interactionMode,
        branch: draftSession.branch,
        worktreePath: draftSession.worktreePath,
        createdAt: draftSession.createdAt,
      },
      ...(shouldCreateWorktree
        ? {
            prepareWorktree: {
              projectCwd: project.cwd,
              baseBranch: draftSession.branch!,
              branch: buildTemporaryWorktreeBranchName(),
            },
            runSetupScript: true,
          }
        : {}),
    },
    createdAt,
  });

  return {
    environmentId: draftSession.environmentId,
    threadId,
  };
}
