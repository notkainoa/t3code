import { isLatestTurnSettled } from "./session-logic";
import type { SidebarThreadSummary } from "./types";

export const PROJECT_THREAD_BOARD_COLUMNS = [
  { key: "todo", label: "Todo" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
] as const;

export type ProjectThreadBoardColumnKey = (typeof PROJECT_THREAD_BOARD_COLUMNS)[number]["key"];

function hasPlanReadyPrompt(thread: SidebarThreadSummary): boolean {
  return (
    !thread.hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan
  );
}

export function resolveProjectThreadBoardColumn(
  thread: SidebarThreadSummary,
): ProjectThreadBoardColumnKey {
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

  return "todo";
}

export function threadBoardSortTimestamp(thread: SidebarThreadSummary): number {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortProjectBoardThreads(
  left: SidebarThreadSummary,
  right: SidebarThreadSummary,
): number {
  return threadBoardSortTimestamp(right) - threadBoardSortTimestamp(left);
}

export function groupProjectThreadsForBoard(threads: readonly SidebarThreadSummary[]) {
  return PROJECT_THREAD_BOARD_COLUMNS.map((column) => ({
    key: column.key,
    label: column.label,
    threads: threads
      .filter((thread) => resolveProjectThreadBoardColumn(thread) === column.key)
      .toSorted(sortProjectBoardThreads),
  }));
}
