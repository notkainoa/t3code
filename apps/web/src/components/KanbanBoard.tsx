import { scopedThreadKey, scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { PlusIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { formatProjectMemberActionLabel, resolveSidebarNewThreadEnvMode } from "./Sidebar.logic";
import { buildThreadSections } from "../threadSections";
import { useSettings } from "../hooks/useSettings";
import { useUiStateStore } from "../uiStateStore";
import { readLocalApi } from "../localApi";
import { cn } from "../lib/utils";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import type { SidebarThreadSummary } from "../types";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { Button } from "./ui/button";
import { useSidebar } from "./ui/sidebar";

interface KanbanBoardProps {
  project: SidebarProjectSnapshot;
  threads: readonly SidebarThreadSummary[];
}

export function KanbanBoard({ project, threads }: KanbanBoardProps) {
  const navigate = useNavigate();
  const sidebarThreadSortOrder = useSettings((settings) => settings.sidebarThreadSortOrder);
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);
  const threadLastVisitedAtById = useUiStateStore(
    useShallow((store) => store.threadLastVisitedAtById),
  );
  const { setOpenMobile } = useSidebar();
  const { handleNewThread } = useNewThreadHandler();

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

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex h-full min-w-max gap-3 p-4 sm:gap-4 sm:p-5">
        {sections.map((section) => (
          <section key={section.id} className="flex w-72 shrink-0 flex-col sm:w-80">
            <div className="mb-2 flex h-8 items-center gap-2 px-1">
              <span className={cn("size-2 rounded-full", section.dotClass)} />
              <h3 className={cn("text-xs font-semibold", section.textClass)}>{section.label}</h3>
              <span className="ml-auto rounded-md bg-muted/45 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground/70">
                {section.threads.length}
              </span>
            </div>
            <div className="min-h-0 flex-1 rounded-lg border border-border/55 bg-muted/15 p-2">
              <div className="flex h-full min-h-0 flex-col gap-2">
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
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
                  {section.threads.length === 0 ? (
                    <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-border/55 text-xs text-muted-foreground/45">
                      No threads
                    </div>
                  ) : null}
                </div>
                {section.id === "todo" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="kanban-add-task-button"
                    className="h-8 w-full shrink-0 justify-center"
                    onClick={handleAddTask}
                  >
                    <PlusIcon className="size-3.5" />
                    Add task
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
