import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime";
import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import {
  hasUnseenCompletion,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "./components/Sidebar.logic";
import { sortThreads } from "./lib/threadSort";
import type { SidebarThreadSummary } from "./types";

type ThreadSectionMatchInput = {
  unseenCompletion: boolean;
  status: ThreadStatusPill | null;
};

export type ThreadSectionDefinition = {
  id: string;
  label: string;
  dotClass: string;
  textClass: string;
  matches: (input: ThreadSectionMatchInput) => boolean;
};

export const THREAD_SECTION_DEFINITIONS: ThreadSectionDefinition[] = [
  {
    id: "todo",
    label: "Backlog",
    dotClass: "bg-muted-foreground/25",
    textClass: "text-muted-foreground/60",
    matches: () => false,
  },
  {
    id: "in-progress",
    label: "In Progress",
    dotClass: "bg-cyan-500 dark:bg-cyan-300/80",
    textClass: "text-cyan-600 dark:text-cyan-300/80",
    matches: ({ status }) => status?.label === "Working" || status?.label === "Connecting",
  },
  {
    id: "needs-input",
    label: "Needs Input",
    dotClass: "bg-amber-500 dark:bg-amber-300/90",
    textClass: "text-amber-600 dark:text-amber-300/90",
    matches: ({ status, unseenCompletion }) =>
      (!unseenCompletion && status?.label === "Plan Ready") ||
      status?.label === "Pending Approval" ||
      status?.label === "Awaiting Input",
  },
  {
    id: "unread",
    label: "Unread",
    dotClass: "bg-brand dark:bg-brand/90",
    textClass: "text-brand dark:text-brand/90",
    matches: ({ status, unseenCompletion }) =>
      unseenCompletion &&
      status?.label !== "Working" &&
      status?.label !== "Connecting" &&
      status?.label !== "Pending Approval" &&
      status?.label !== "Awaiting Input",
  },
  {
    id: "done",
    label: "Done",
    dotClass: "bg-muted-foreground/40",
    textClass: "text-muted-foreground/70",
    matches: ({ status, unseenCompletion }) => !unseenCompletion && status === null,
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
  const sectionMatchByThreadKey = new Map<string, ThreadSectionMatchInput>();

  for (const thread of sortedThreads) {
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const lastVisitedAt = lastVisitedAtByThreadKey.get(threadKey) ?? undefined;
    const threadWithVisit = {
      ...thread,
      ...(lastVisitedAt ? { lastVisitedAt } : {}),
    };
    const status = resolveThreadStatusPill({
      thread: threadWithVisit,
    });
    statusByThreadKey.set(threadKey, status);
    sectionMatchByThreadKey.set(threadKey, {
      status,
      unseenCompletion: hasUnseenCompletion(threadWithVisit),
    });
  }

  const sections = THREAD_SECTION_DEFINITIONS.map((section) => ({
    dotClass: section.dotClass,
    id: section.id,
    label: section.label,
    matches: section.matches,
    textClass: section.textClass,
    threads: sortedThreads.filter((thread) => {
      const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      const matchInput = sectionMatchByThreadKey.get(threadKey);
      return matchInput ? section.matches(matchInput) : false;
    }),
  }));

  return {
    sections,
    sortedThreads,
    statusByThreadKey,
  };
}
