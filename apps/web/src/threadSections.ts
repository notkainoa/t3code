import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime";
import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import { resolveThreadStatusPill, type ThreadStatusPill } from "./components/Sidebar.logic";
import { sortThreads } from "./lib/threadSort";
import type { SidebarThreadSummary } from "./types";

export type ThreadSectionDefinition = {
  id: string;
  label: string;
  dotClass: string;
  textClass: string;
  matches: (status: ThreadStatusPill | null) => boolean;
};

export const THREAD_SECTION_DEFINITIONS: ThreadSectionDefinition[] = [
  {
    id: "todo",
    label: "Todo",
    dotClass: "bg-muted-foreground/25",
    textClass: "text-muted-foreground/60",
    matches: (status) => status?.label === "Plan Ready",
  },
  {
    id: "in-progress",
    label: "In Progress",
    dotClass: "bg-cyan-500 dark:bg-cyan-300/80",
    textClass: "text-cyan-600 dark:text-cyan-300/80",
    matches: (status) => status?.label === "Working" || status?.label === "Connecting",
  },
  {
    id: "needs-input",
    label: "Needs Input",
    dotClass: "bg-amber-500 dark:bg-amber-300/90",
    textClass: "text-amber-600 dark:text-amber-300/90",
    matches: (status) => status?.label === "Pending Approval" || status?.label === "Awaiting Input",
  },
  {
    id: "unread",
    label: "Unread",
    dotClass: "bg-brand dark:bg-brand/90",
    textClass: "text-brand dark:text-brand/90",
    matches: (status) => status?.label === "Completed",
  },
  {
    id: "done",
    label: "Done",
    dotClass: "bg-muted-foreground/40",
    textClass: "text-muted-foreground/70",
    matches: (status) => status === null,
  },
];

export function buildThreadSections(input: {
  threads: readonly SidebarThreadSummary[];
  lastVisitedAtByThreadKey: ReadonlyMap<string, string | null>;
  sortOrder: SidebarThreadSortOrder;
}): {
  sections: Array<ThreadSectionDefinition & { threads: SidebarThreadSummary[] }>;
  statusByThreadKey: ReadonlyMap<string, ThreadStatusPill | null>;
  sortedThreads: SidebarThreadSummary[];
} {
  const { threads, lastVisitedAtByThreadKey, sortOrder } = input;
  const visibleThreads = threads.filter((thread) => thread.archivedAt === null);
  const sortedThreads = sortThreads(visibleThreads, sortOrder);
  const statusByThreadKey = new Map<string, ThreadStatusPill | null>();

  for (const thread of sortedThreads) {
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const lastVisitedAt = lastVisitedAtByThreadKey.get(threadKey) ?? undefined;
    statusByThreadKey.set(
      threadKey,
      resolveThreadStatusPill({
        thread: {
          ...thread,
          ...(lastVisitedAt ? { lastVisitedAt } : {}),
        },
      }),
    );
  }

  const sections = THREAD_SECTION_DEFINITIONS.map((section) => ({
    dotClass: section.dotClass,
    id: section.id,
    label: section.label,
    matches: section.matches,
    textClass: section.textClass,
    threads: sortedThreads.filter((thread) => {
      const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      return section.matches(statusByThreadKey.get(threadKey) ?? null);
    }),
  }));

  return {
    sections,
    sortedThreads,
    statusByThreadKey,
  };
}
