import { scopedThreadKey, scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { FolderKanbanIcon, MessageSquareIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useMemo, useRef, useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { APP_DISPLAY_NAME, APP_STAGE_LABEL, APP_VERSION } from "../branding";
import { useCommandPaletteStore } from "../commandPaletteStore";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { useUiStateStore } from "../uiStateStore";
import { getProjectOrderKey } from "../logicalProject";
import { orderItemsByPreferredIds } from "./Sidebar.logic";
import { ProjectFavicon } from "./ProjectFavicon";
import { cn } from "../lib/utils";

const RECENT_THREAD_TAB_LIMIT = 6;
const RECENT_THREAD_TABS_STORAGE_KEY = "t3code:recent-thread-tabs:v1";

function readRecentThreadTabKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_THREAD_TABS_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function writeRecentThreadTabKeys(keys: readonly string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RECENT_THREAD_TABS_STORAGE_KEY, JSON.stringify(keys));
}

function useScrollShadows(tabCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevTabCountRef = useRef(tabCount);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (tabCount > prevTabCountRef.current) {
      el.scrollLeft = el.scrollWidth;
    }
    prevTabCountRef.current = tabCount;
    updateScrollState();
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, [tabCount, updateScrollState]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      if (!el || el.scrollWidth <= el.clientWidth || event.deltaY === 0) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
      updateScrollState();
    },
    [updateScrollState],
  );

  return { scrollRef, canScrollLeft, canScrollRight, updateScrollState, handleWheel };
}

function T3Wordmark() {
  return (
    <svg
      aria-label="T3"
      className="h-2.5 w-auto shrink-0 text-foreground"
      viewBox="15.5309 37 94.3941 56.96"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ProjectTabs() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const params = useParams({ strict: false });
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const [recentThreadKeys, setRecentThreadKeys] = useState(readRecentThreadTabKeys);
  const openAddProject = useCommandPaletteStore((store) => store.openAddProject);
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
      }),
    [projectOrder, projects],
  );
  const activeThreadKey = useMemo(() => {
    if (typeof params.environmentId !== "string" || typeof params.threadId !== "string") {
      return null;
    }
    return scopedThreadKey(
      scopeThreadRef(EnvironmentId.make(params.environmentId), ThreadId.make(params.threadId)),
    );
  }, [params.environmentId, params.threadId]);
  const activeProjectRef = useMemo(() => {
    if (typeof params.environmentId === "string" && typeof params.projectId === "string") {
      return scopeProjectRef(
        EnvironmentId.make(params.environmentId),
        ProjectId.make(params.projectId),
      );
    }
    if (activeThreadKey) {
      const thread = threads.find(
        (item) => scopedThreadKey(scopeThreadRef(item.environmentId, item.id)) === activeThreadKey,
      );
      return thread ? scopeProjectRef(thread.environmentId, thread.projectId) : null;
    }
    return null;
  }, [activeThreadKey, params.environmentId, params.projectId, threads]);
  const recentThreads = useMemo(
    () =>
      recentThreadKeys.flatMap((key) => {
        const thread = threads.find(
          (item) => scopedThreadKey(scopeThreadRef(item.environmentId, item.id)) === key,
        );
        return thread && thread.archivedAt === null ? [thread] : [];
      }),
    [recentThreadKeys, threads],
  );
  const recentThreadsForDisplay = useMemo(() => recentThreads.toReversed(), [recentThreads]);
  useEffect(() => {
    if (!activeThreadKey) return;
    setRecentThreadKeys((current) => {
      const next = [activeThreadKey, ...current.filter((key) => key !== activeThreadKey)].slice(
        0,
        RECENT_THREAD_TAB_LIMIT,
      );
      if (next.length === current.length && next.every((key, index) => key === current[index])) {
        return current;
      }
      writeRecentThreadTabKeys(next);
      return next;
    });
  }, [activeThreadKey]);
  const projectScroll = useScrollShadows(orderedProjects.length);
  const recentScroll = useScrollShadows(recentThreadsForDisplay.length);
  const showProjectTabs = !pathname.startsWith("/settings") && !pathname.startsWith("/pair");

  if (!showProjectTabs) {
    return null;
  }

  return (
    <div className="relative z-10 flex h-11 min-w-0 items-center gap-2 px-1 text-foreground">
      <Link
        to="/"
        className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 outline-hidden ring-ring transition-colors hover:text-foreground focus-visible:ring-2"
        aria-label={APP_DISPLAY_NAME}
        title={`Version ${APP_VERSION}`}
      >
        <T3Wordmark />
        <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
          Code
        </span>
        <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
          {APP_STAGE_LABEL}
        </span>
      </Link>

      <div className="flex min-w-0 max-w-[55%] flex-[0_1_auto] items-center gap-1 overflow-hidden">
        <div className="relative min-w-0 overflow-hidden">
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 left-0 z-10 w-7 bg-gradient-to-r from-muted to-transparent transition-opacity",
              projectScroll.canScrollLeft ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 z-10 w-7 bg-gradient-to-l from-muted to-transparent transition-opacity",
              projectScroll.canScrollRight ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            ref={projectScroll.scrollRef}
            onScroll={projectScroll.updateScrollState}
            onWheel={projectScroll.handleWheel}
            onMouseEnter={projectScroll.updateScrollState}
            className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {orderedProjects.map((project) => {
              const active =
                activeProjectRef?.environmentId === project.environmentId &&
                activeProjectRef.projectId === project.id;
              return (
                <Link
                  key={`${project.environmentId}:${project.id}`}
                  to="/$environmentId/board/$projectId"
                  params={{ environmentId: project.environmentId, projectId: project.id }}
                  className={cn(
                    "group relative flex h-8 max-w-56 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground",
                    active && "bg-surface-1 text-foreground",
                  )}
                >
                  <ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />
                  <span className="truncate">{project.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Add project"
          onClick={openAddProject}
        >
          {orderedProjects.length === 0 ? (
            <FolderKanbanIcon className="size-4" />
          ) : (
            <PlusIcon className="size-4" />
          )}
        </button>
      </div>

      <div className="hidden h-4 shrink-0 border-l border-border/70 md:block" />

      <div className="relative hidden min-w-0 flex-1 overflow-hidden md:block">
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 z-10 w-7 bg-gradient-to-r from-muted to-transparent transition-opacity",
            recentScroll.canScrollLeft ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 z-10 w-7 bg-gradient-to-l from-muted to-transparent transition-opacity",
            recentScroll.canScrollRight ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          ref={recentScroll.scrollRef}
          onScroll={recentScroll.updateScrollState}
          onWheel={recentScroll.handleWheel}
          onMouseEnter={recentScroll.updateScrollState}
          className="flex min-w-full items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {recentThreadsForDisplay.map((thread) => {
            const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
            const active = key === activeThreadKey;
            return (
              <Link
                key={key}
                to="/$environmentId/$threadId"
                params={{ environmentId: thread.environmentId, threadId: thread.id }}
                className={cn(
                  "group relative flex h-8 max-w-52 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground",
                  active && "bg-surface-1 text-foreground",
                )}
              >
                <MessageSquareIcon className="size-3.5 shrink-0" />
                <span className="truncate">{thread.title}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <Link
        to="/settings"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Settings"
      >
        <SettingsIcon className="size-4" />
      </Link>
    </div>
  );
}
