import { scopeProjectRef } from "@t3tools/client-runtime";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { resolveThreadStatusPill } from "../components/Sidebar.logic";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import {
  projectColumnViewTransitionName,
  projectThreadViewTransitionName,
  startRouteViewTransition,
} from "../lib/viewTransition";
import { groupProjectThreadsForBoard } from "../projectThreadBoard";
import { selectSidebarThreadsForProjectRefs, useStore } from "../store";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";

function BoardThreadCard({ thread }: { thread: SidebarThreadSummary }) {
  const navigate = useNavigate();
  const status = resolveThreadStatusPill({ thread });
  const updatedAt = thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt;

  return (
    <Link
      to="/$environmentId/$threadId"
      params={{
        environmentId: thread.environmentId,
        threadId: thread.id,
      }}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.altKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.defaultPrevented
        ) {
          return;
        }
        event.preventDefault();
        void startRouteViewTransition(() => {
          void navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: thread.environmentId, threadId: thread.id },
          });
        });
      }}
      style={{
        viewTransitionName: projectThreadViewTransitionName({
          environmentId: thread.environmentId,
          threadId: thread.id,
        }),
      }}
      className="rounded-md border border-border/85 bg-card p-3 text-left shadow-xs transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-border hover:bg-background hover:shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Thread
          </p>
          <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-tight text-foreground">
            {thread.title}
          </h3>
        </div>
        {status ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
            <span
              className={`size-1.5 rounded-full ${status.dotClass} ${
                status.pulse ? "animate-pulse" : ""
              }`}
            />
            {status.label}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {thread.branch ? (
          <span className="rounded-md bg-secondary px-2 py-0.5">{thread.branch}</span>
        ) : null}
        <span>{formatRelativeTimeLabel(updatedAt)}</span>
      </div>
    </Link>
  );
}

function ProjectBoardIndexRouteView() {
  const params = Route.useParams();
  const environmentId = EnvironmentId.make(params.environmentId);
  const projectId = ProjectId.make(params.projectId);
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const projectThreads = useStore(
    useShallow((state) =>
      selectSidebarThreadsForProjectRefs(state, [projectRef]).filter(
        (thread) => thread.archivedAt === null,
      ),
    ),
  );
  const columns = useMemo(() => groupProjectThreadsForBoard(projectThreads), [projectThreads]);
  const { handleNewThread } = useNewThreadHandler();

  return (
    <SidebarInset className="h-full min-h-0 overflow-hidden overscroll-y-none bg-card text-foreground">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
        <section className="grid min-h-0 min-w-0 flex-1 gap-4 overflow-x-auto bg-muted/30 p-3 sm:p-5 [grid-template-columns:repeat(4,minmax(17rem,1fr))]">
          {columns.map((column) => (
            <section
              key={column.key}
              style={{
                viewTransitionName: projectColumnViewTransitionName({
                  environmentId,
                  projectId,
                  columnKey: column.key,
                }),
              }}
              className="flex min-h-[24rem] flex-col rounded-md border border-border/85 bg-background/80 p-3 shadow-xs"
            >
              <div className="mb-3 flex items-center justify-between border-b border-border/70 px-1 pb-2">
                <h2 className="text-sm font-semibold tracking-wide text-foreground">
                  {column.label}
                </h2>
                <span className="rounded-md border bg-card px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {column.threads.length}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-3">
                {column.threads.length === 0 ? (
                  <div className="rounded-lg border border-dashed bg-muted/45 px-3 py-6 text-center text-sm text-muted-foreground">
                    No threads in {column.label.toLowerCase()}.
                  </div>
                ) : (
                  column.threads.map((thread) => (
                    <BoardThreadCard key={thread.id} thread={thread} />
                  ))
                )}
              </div>

              {column.key === "todo" && (
                <Button
                  variant="outline"
                  className="mt-3 w-full justify-center rounded-md border-dashed text-muted-foreground hover:border-solid hover:text-foreground"
                  onClick={() => {
                    void handleNewThread(projectRef);
                  }}
                >
                  + New Thread
                </Button>
              )}
            </section>
          ))}
        </section>
      </main>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/board/$projectId/")({
  component: ProjectBoardIndexRouteView,
});
