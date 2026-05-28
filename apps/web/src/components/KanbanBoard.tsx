import { scopedThreadKey, scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { Loader2Icon, PlayIcon, PlusIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type BacklogTask,
  type BacklogTaskId,
  deriveBacklogTaskTitle,
  newBacklogTaskId,
  startBacklogTask,
  useBacklogTaskStore,
} from "../backlogTasks";
import { formatProjectMemberActionLabel, resolveSidebarNewThreadEnvMode } from "./Sidebar.logic";
import { buildThreadSections } from "../threadSections";
import { useSettings } from "../hooks/useSettings";
import { useSavedEnvironmentRuntimeStore } from "../environments/runtime";
import { useServerConfig } from "../rpc/serverState";
import { useUiStateStore } from "../uiStateStore";
import { readLocalApi } from "../localApi";
import { cn } from "../lib/utils";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import type { SidebarThreadSummary } from "../types";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useComposerDraftStore, useComposerThreadDraft, type DraftId } from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { BacklogTaskComposerDialog } from "./BacklogTaskComposerDialog";
import { Button } from "./ui/button";
import { useSidebar } from "./ui/sidebar";
import { stackedThreadToast, toastManager } from "./ui/toast";

const EMPTY_BACKLOG_TASK_IDS: readonly string[] = [];

interface KanbanBoardProps {
  project: SidebarProjectSnapshot;
  threads: readonly SidebarThreadSummary[];
  todoColumnVisible: boolean;
}

function BacklogTaskCard({
  task,
  isStarting,
  onStart,
}: {
  task: BacklogTask;
  isStarting: boolean;
  onStart: (taskId: BacklogTaskId) => void;
}) {
  const draft = useComposerThreadDraft(task.draftId);
  const title = draft.prompt.trim().length > 0 ? deriveBacklogTaskTitle(draft.prompt) : task.title;

  return (
    <div className="group rounded-lg border border-border/65 bg-card/55 p-3 text-left shadow-xs/5 transition-[background-color,border-color,box-shadow] hover:border-foreground/18 hover:bg-card/80 hover:shadow-sm/5">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-medium text-foreground/90">
            {title || "Untitled task"}
          </span>
          <time dateTime={task.updatedAt} className="mt-2 block text-xs text-muted-foreground/70">
            {new Date(task.updatedAt).toLocaleDateString()}
          </time>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          className="size-8 rounded-full"
          disabled={isStarting}
          aria-label={`Start ${title || "backlog task"}`}
          title="Start task"
          onClick={() => onStart(task.id)}
        >
          {isStarting ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

function EmptyBacklogColumnPrompt() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-end px-4 pb-1 pt-8 text-center">
      <div className="rounded-md border border-border/55 bg-background/55 px-3 py-2 shadow-xs/5">
        <p className="text-sm font-medium text-foreground/80">Save tasks here for later.</p>
        <p className="mt-1 text-xs text-muted-foreground/65">They won't run yet.</p>
      </div>
      <svg
        aria-hidden="true"
        viewBox="0 0 96 152"
        className="mt-2 h-36 w-24 overflow-visible text-muted-foreground/50"
      >
        <path
          d="M38 4C78 30 80 92 48 139"
          fill="none"
          stroke="currentColor"
          strokeDasharray="5 7"
          strokeLinecap="round"
          strokeWidth="2"
        />
        <path
          d="M48 139L39 127M48 139L62 134"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

export function KanbanBoard({ project, threads, todoColumnVisible }: KanbanBoardProps) {
  const navigate = useNavigate();
  const sidebarThreadSortOrder = useSettings((settings) => settings.sidebarThreadSortOrder);
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);
  const serverConfig = useServerConfig();
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((store) => store.byId);
  const threadLastVisitedAtById = useUiStateStore(
    useShallow((store) => store.threadLastVisitedAtById),
  );
  const { setOpenMobile } = useSidebar();
  const { handleNewThread } = useNewThreadHandler();
  const [pendingBacklogComposer, setPendingBacklogComposer] = useState<{
    taskId: BacklogTaskId;
    draftId: DraftId;
  } | null>(null);
  const [startingTaskIds, setStartingTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const backlogTaskIds = useBacklogTaskStore(
    (store) => store.taskIdsByProjectKey[project.projectKey] ?? EMPTY_BACKLOG_TASK_IDS,
  );
  const backlogTasksById = useBacklogTaskStore((store) => store.tasksById);
  const deleteBacklogTask = useBacklogTaskStore((store) => store.deleteTask);
  const backlogTasks = useMemo(
    () => backlogTaskIds.flatMap((taskId) => backlogTasksById[taskId] ?? []),
    [backlogTaskIds, backlogTasksById],
  );
  const providerStatuses = useMemo(() => serverConfig?.providers ?? [], [serverConfig?.providers]);
  const providerStatusesByEnvironmentId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(savedEnvironmentRuntimeById).flatMap(([environmentId, runtime]) =>
          runtime.serverConfig?.providers ? [[environmentId, runtime.serverConfig.providers]] : [],
        ),
      ),
    [savedEnvironmentRuntimeById],
  );

  const lastVisitedAtByThreadKey = useMemo(
    () => new Map(Object.entries(threadLastVisitedAtById)),
    [threadLastVisitedAtById],
  );

  const { sections } = useMemo(
    () =>
      buildThreadSections({
        threads,
        lastVisitedAtByThreadKey,
        sortOrder: sidebarThreadSortOrder,
      }),
    [lastVisitedAtByThreadKey, sidebarThreadSortOrder, threads],
  );
  const visibleSections = useMemo(
    () => (todoColumnVisible ? sections : sections.filter((section) => section.id !== "todo")),
    [sections, todoColumnVisible],
  );

  const handleThreadClick = useCallback(
    (thread: SidebarThreadSummary) => {
      setOpenMobile(false);
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: thread.environmentId,
          threadId: thread.id,
        },
      });
    },
    [navigate, setOpenMobile],
  );

  const handleAddTask = useCallback(() => {
    const createForMember = (member: SidebarProjectSnapshot["memberProjects"][number]) => {
      setOpenMobile(false);
      void handleNewThread(scopeProjectRef(member.environmentId, member.id), {
        envMode: resolveSidebarNewThreadEnvMode({
          defaultEnvMode: defaultThreadEnvMode,
        }),
      });
    };

    if (project.memberProjects.length === 1) {
      createForMember(project.memberProjects[0]!);
      return;
    }

    void (async () => {
      const api = readLocalApi();
      if (!api) {
        createForMember(project.memberProjects[0]!);
        return;
      }

      const clicked = await api.contextMenu.show(
        project.memberProjects.map((member) => ({
          id: member.physicalProjectKey,
          label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
        })),
      );
      const targetMember = project.memberProjects.find(
        (member) => member.physicalProjectKey === clicked,
      );
      if (targetMember) {
        createForMember(targetMember);
      }
    })();
  }, [
    defaultThreadEnvMode,
    handleNewThread,
    project.groupedProjectCount,
    project.memberProjects,
    setOpenMobile,
  ]);

  const openBacklogComposerForMember = useCallback(
    (member: SidebarProjectSnapshot["memberProjects"][number]) => {
      const draftId = newDraftId();
      const taskId = newBacklogTaskId();
      useComposerDraftStore
        .getState()
        .setStandaloneDraftThread(
          draftId,
          scopeProjectRef(member.environmentId, member.id),
          project.projectKey,
          {
            threadId: newThreadId(),
            envMode: resolveSidebarNewThreadEnvMode({
              defaultEnvMode: defaultThreadEnvMode,
            }),
          },
        );
      useComposerDraftStore.getState().applyStickyState(draftId);
      setOpenMobile(false);
      setPendingBacklogComposer({ taskId, draftId });
    },
    [defaultThreadEnvMode, project.projectKey, setOpenMobile],
  );

  const handleAddBacklogTask = useCallback(() => {
    if (project.memberProjects.length === 1) {
      openBacklogComposerForMember(project.memberProjects[0]!);
      return;
    }

    void (async () => {
      const api = readLocalApi();
      if (!api) {
        openBacklogComposerForMember(project.memberProjects[0]!);
        return;
      }

      const clicked = await api.contextMenu.show(
        project.memberProjects.map((member) => ({
          id: member.physicalProjectKey,
          label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
        })),
      );
      const targetMember = project.memberProjects.find(
        (member) => member.physicalProjectKey === clicked,
      );
      if (targetMember) {
        openBacklogComposerForMember(targetMember);
      }
    })();
  }, [openBacklogComposerForMember, project.groupedProjectCount, project.memberProjects]);

  const closePendingBacklogComposer = useCallback(() => {
    if (pendingBacklogComposer) {
      useComposerDraftStore.getState().clearDraftThread(pendingBacklogComposer.draftId);
    }
    setPendingBacklogComposer(null);
  }, [pendingBacklogComposer]);

  const handleBacklogTaskSaved = useCallback(() => {
    setPendingBacklogComposer(null);
  }, []);

  const startBacklogTaskById = useCallback(
    async (taskId: BacklogTaskId) => {
      if (startingTaskIds.has(taskId)) {
        return;
      }
      setStartingTaskIds((current) => new Set(current).add(taskId));
      try {
        const task = useBacklogTaskStore.getState().tasksById[taskId];
        await startBacklogTask({ taskId, providerStatuses, providerStatusesByEnvironmentId });
        if (task) {
          deleteBacklogTask(taskId);
          useComposerDraftStore.getState().clearDraftThread(task.draftId);
        }
        toastManager.add({
          type: "success",
          title: "Backlog task started",
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start backlog task",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      } finally {
        setStartingTaskIds((current) => {
          const next = new Set(current);
          next.delete(taskId);
          return next;
        });
      }
    },
    [deleteBacklogTask, providerStatuses, providerStatusesByEnvironmentId, startingTaskIds],
  );

  const handleStartAllBacklogTasks = useCallback(() => {
    void (async () => {
      for (const task of backlogTasks) {
        await startBacklogTaskById(task.id);
      }
    })();
  }, [backlogTasks, startBacklogTaskById]);

  return (
    <>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full min-w-max gap-3 p-4 sm:gap-4 sm:p-5">
          {visibleSections.map((section) => {
            const sectionBacklogTasks = section.id === "todo" ? backlogTasks : [];
            const isStartingBacklogTasks = sectionBacklogTasks.some((task) =>
              startingTaskIds.has(task.id),
            );
            const itemCount =
              section.id === "todo" ? sectionBacklogTasks.length : section.threads.length;
            return (
              <section key={section.id} className="flex w-72 shrink-0 flex-col sm:w-80">
                <div className="mb-2 flex h-8 items-center gap-2 px-1">
                  <span className={cn("size-2 rounded-full", section.dotClass)} />
                  <h3 className={cn("text-xs font-semibold", section.textClass)}>
                    {section.label}
                  </h3>
                  {section.id === "todo" ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="ml-auto h-7 rounded-full px-2.5"
                      disabled={sectionBacklogTasks.length === 0 || isStartingBacklogTasks}
                      onClick={handleStartAllBacklogTasks}
                    >
                      {isStartingBacklogTasks ? (
                        <Loader2Icon className="size-3 animate-spin" />
                      ) : (
                        <PlayIcon className="size-3" />
                      )}
                      {isStartingBacklogTasks ? "Starting" : "Start all"}
                      {sectionBacklogTasks.length > 0 ? ` (${itemCount})` : ""}
                    </Button>
                  ) : (
                    <span className="ml-auto rounded-md bg-muted/45 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground/70">
                      {itemCount}
                    </span>
                  )}
                </div>
                <div className="min-h-0 flex-1 rounded-lg border border-border/55 bg-muted/15 p-2">
                  <div className="flex h-full min-h-0 flex-col gap-2">
                    <div
                      className={cn(
                        "min-h-0 flex-1 overflow-y-auto",
                        itemCount === 0 ? "h-full" : "space-y-2",
                      )}
                    >
                      {sectionBacklogTasks.map((task) => (
                        <BacklogTaskCard
                          key={task.id}
                          task={task}
                          isStarting={startingTaskIds.has(task.id)}
                          onStart={startBacklogTaskById}
                        />
                      ))}
                      {section.threads.map((thread) => (
                        <button
                          key={scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}
                          type="button"
                          onClick={() => handleThreadClick(thread)}
                          className="group w-full rounded-lg border border-border/65 bg-card/55 p-3 text-left shadow-xs/5 transition-[background-color,border-color,box-shadow] hover:border-foreground/18 hover:bg-card/80 hover:shadow-sm/5"
                        >
                          <span className="line-clamp-2 text-sm font-medium text-foreground/90">
                            {thread.title || "Untitled"}
                          </span>
                          {thread.updatedAt ? (
                            <time
                              dateTime={thread.updatedAt}
                              className="mt-2 block text-xs text-muted-foreground/70"
                            >
                              {new Date(thread.updatedAt).toLocaleDateString()}
                            </time>
                          ) : null}
                        </button>
                      ))}
                      {itemCount === 0 ? (
                        section.id === "todo" ? (
                          <div className="flex h-full min-h-0 flex-col">
                            <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-border/55 text-xs text-muted-foreground/45">
                              No backlog tasks
                            </div>
                            <EmptyBacklogColumnPrompt />
                          </div>
                        ) : (
                          <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-border/55 text-xs text-muted-foreground/45">
                            No threads
                          </div>
                        )
                      ) : null}
                    </div>
                    {section.id === "todo" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="kanban-add-task-button"
                        className="h-8 w-full shrink-0 justify-center"
                        onClick={handleAddBacklogTask}
                      >
                        <PlusIcon className="size-3.5" />
                        New task
                      </Button>
                    ) : section.id === "in-progress" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="kanban-add-task-button"
                        className="h-8 w-full shrink-0 justify-center"
                        onClick={handleAddTask}
                      >
                        <PlusIcon className="size-3.5" />
                        New task
                      </Button>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {pendingBacklogComposer ? (
        <BacklogTaskComposerDialog
          project={project}
          taskId={pendingBacklogComposer.taskId}
          draftId={pendingBacklogComposer.draftId}
          open
          onCancel={closePendingBacklogComposer}
          onSaved={handleBacklogTaskSaved}
        />
      ) : null}
    </>
  );
}
