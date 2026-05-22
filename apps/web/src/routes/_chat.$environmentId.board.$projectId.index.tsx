import { scopeProjectRef } from "@t3tools/client-runtime";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { resolveThreadStatusPill } from "../components/Sidebar.logic";
import { Badge } from "../components/ui/badge";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { isLatestTurnSettled } from "../session-logic";
import {
  selectProjectsForEnvironment,
  selectSidebarThreadsForProjectRefs,
  useStore,
} from "../store";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";

const BOARD_COLUMNS = [
  { key: "todo", label: "Todo" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
] as const;

type BoardColumnKey = (typeof BOARD_COLUMNS)[number]["key"];

function hasPlanReadyPrompt(thread: SidebarThreadSummary): boolean {
  return (
    !thread.hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan
  );
}

function resolveThreadBoardColumn(thread: SidebarThreadSummary): BoardColumnKey {
  if (thread.session?.status === "running" || thread.session?.status === "connecting") {
    return "in_progress";
  }

  if (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.latestTurn?.state === "error" ||
    hasPlanReadyPrompt(thread)
  ) {
    return "review";
  }

  if (isLatestTurnSettled(thread.latestTurn, thread.session)) {
    return "done";
  }

  if (thread.latestTurn !== null || thread.latestUserMessageAt !== null) {
    return "todo";
  }

  return "todo";
}

function threadSortTimestamp(thread: SidebarThreadSummary): number {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortBoardThreads(left: SidebarThreadSummary, right: SidebarThreadSummary): number {
  return threadSortTimestamp(right) - threadSortTimestamp(left);
}

function BoardThreadCard({ thread }: { thread: SidebarThreadSummary }) {
  const status = resolveThreadStatusPill({ thread });
  const updatedAt = thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt;

  return (
    <Link
      to="/$environmentId/$threadId"
      params={{
        environmentId: thread.environmentId,
        threadId: thread.id,
      }}
      className="rounded-lg border bg-background p-3 text-left shadow-sm transition-colors hover:bg-accent/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Thread
          </p>
          <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-tight text-foreground">
            {thread.title}
          </h3>
        </div>
        {status ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground">
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
  const projects = useStore(
    useShallow((state) => selectProjectsForEnvironment(state, environmentId)),
  );
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
  const activeProject = projects.find((project) => project.id === projectId) ?? null;
  const columns = useMemo(
    () =>
      BOARD_COLUMNS.map((column) => ({
        key: column.key,
        label: column.label,
        threads: projectThreads
          .filter((thread) => resolveThreadBoardColumn(thread) === column.key)
          .toSorted(sortBoardThreads),
      })),
    [projectThreads],
  );
  const activeThreadCount = projectThreads.filter(
    (thread) => thread.session?.status === "running" || thread.session?.status === "connecting",
  ).length;

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-5 sm:py-3">
          <SidebarTrigger className="size-7 shrink-0 md:hidden" />
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
            <h2 className="shrink truncate text-sm font-medium text-foreground">Kanban</h2>
            {activeProject && (
              <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
                <span className="min-w-0 truncate">{activeProject.name}</span>
              </Badge>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <span>{projectThreads.length} threads</span>
            <span>{activeThreadCount} active</span>
          </div>
        </header>

        <section className="grid min-h-0 min-w-0 flex-1 gap-4 overflow-x-auto p-4 [grid-template-columns:repeat(4,minmax(17rem,1fr))] sm:p-5">
          {columns.map((column) => (
            <section
              key={column.key}
              className="flex min-h-[24rem] flex-col rounded-xl border bg-card p-3 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between border-b px-1 pb-3">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide text-foreground">
                    {column.label}
                  </h2>
                  <p className="text-xs text-muted-foreground">{column.threads.length} threads</p>
                </div>
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
