import { scopedThreadKey, scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import {
  type ContextMenuItem,
  EnvironmentId,
  ProjectId,
  type SidebarProjectGroupingMode,
  ThreadId,
} from "@t3tools/contracts";
import { Link, useCanGoBack, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeftIcon, PlusIcon, RotateCcwIcon, SettingsIcon, SquarePenIcon } from "lucide-react";
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
import {
  deriveProjectGroupingOverrideKey,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import {
  orderItemsByPreferredIds,
  resolveSidebarNewThreadEnvMode,
  resolveSidebarNewThreadSeedContext,
} from "./Sidebar.logic";
import { ProjectFavicon } from "./ProjectFavicon";
import { cn, newCommandId } from "../lib/utils";
import { readLocalApi } from "../localApi";
import { readEnvironmentApi } from "../environmentApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import { ThreadTabStatusIcon } from "./ThreadStatusIndicators";
import { dispatchSettingsRestoredEvent } from "./settings/settingsEvents";
import { SETTINGS_NAV_ITEMS } from "./settings/settingsNav";
import { useSettingsRestore } from "./settings/SettingsPanels";
import type { Project } from "../types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { stackedThreadToast, toastManager } from "./ui/toast";

const RECENT_THREAD_TAB_LIMIT = 6;
const RECENT_THREAD_TABS_STORAGE_KEY = "t3code:recent-thread-tabs:v1";
const topBarTabBaseClassName =
  "group relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-muted-foreground outline-hidden ring-ring transition-colors hover:bg-surface-1 hover:text-foreground focus-visible:ring-2";
const topBarIconButtonBaseClassName =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-hidden ring-ring transition-colors hover:bg-surface-1 hover:text-foreground focus-visible:ring-2";
const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "Group by repository",
  repository_path: "Group by repository path",
  separate: "Keep separate",
};

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

function projectGroupingModeDescription(mode: SidebarProjectGroupingMode): string {
  switch (mode) {
    case "repository":
      return "Projects from the same repository share one sidebar row.";
    case "repository_path":
      return "Projects group only when both the repository and repo-relative path match.";
    case "separate":
      return "This project always appears as its own row.";
  }
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

function RestoreDefaultsButton() {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(
    dispatchSettingsRestoredEvent,
  );

  return (
    <Button
      size="xs"
      variant="outline"
      disabled={changedSettingLabels.length === 0}
      onClick={() => void restoreDefaults()}
    >
      <RotateCcwIcon className="size-3.5" />
      Restore defaults
    </Button>
  );
}

function SettingsTopBar({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const scroll = useScrollShadows(SETTINGS_NAV_ITEMS.length);

  const navigateBackWithinApp = useCallback(() => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, navigate]);

  return (
    <div className="relative z-10 flex h-11 min-w-0 items-center gap-2 px-1 text-foreground">
      <div className="inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1 py-1">
        <button
          type="button"
          className={topBarIconButtonBaseClassName}
          aria-label="Back"
          onClick={navigateBackWithinApp}
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <span className="truncate text-sm font-medium tracking-tight text-foreground">
          Settings
        </span>
      </div>

      <div className="hidden h-4 shrink-0 border-l border-border/70 md:block" />

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 z-10 w-7 bg-gradient-to-r from-muted to-transparent transition-opacity",
            scroll.canScrollLeft ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 z-10 w-7 bg-gradient-to-l from-muted to-transparent transition-opacity",
            scroll.canScrollRight ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          ref={scroll.scrollRef}
          onScroll={scroll.updateScrollState}
          onWheel={scroll.handleWheel}
          onMouseEnter={scroll.updateScrollState}
          className="flex min-w-full items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {SETTINGS_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                replace
                className={cn(topBarTabBaseClassName, active && "bg-surface-1 text-foreground")}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="shrink-0">
        <RestoreDefaultsButton />
      </div>
    </div>
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
  const projectGroupingSettings = useSettings(selectProjectGroupingSettings);
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);
  const { updateSettings } = useUpdateSettings();
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>();
  const [projectRenameTarget, setProjectRenameTarget] = useState<Project | null>(null);
  const [projectRenameTitle, setProjectRenameTitle] = useState("");
  const [projectGroupingTarget, setProjectGroupingTarget] = useState<Project | null>(null);
  const [projectGroupingSelection, setProjectGroupingSelection] = useState<
    SidebarProjectGroupingMode | "inherit"
  >("inherit");
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
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
  const threadCountByProjectKey = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of threads) {
      const key = `${thread.environmentId}:${thread.projectId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [threads]);
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
  const showSettingsTabs = pathname.startsWith("/settings");
  const showProjectTabs = !showSettingsTabs && !pathname.startsWith("/pair");
  const handleTopBarTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  }, []);

  const closeProjectRenameDialog = useCallback(() => {
    setProjectRenameTarget(null);
    setProjectRenameTitle("");
  }, []);

  const submitProjectRename = useCallback(async () => {
    if (!projectRenameTarget) {
      return;
    }

    const trimmed = projectRenameTitle.trim();
    if (trimmed.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Project title cannot be empty",
      });
      return;
    }

    if (trimmed === projectRenameTarget.name) {
      closeProjectRenameDialog();
      return;
    }

    const api = readEnvironmentApi(projectRenameTarget.environmentId);
    if (!api) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to rename project",
          description: "Project API unavailable.",
        }),
      );
      return;
    }

    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: projectRenameTarget.id,
        title: trimmed,
      });
      closeProjectRenameDialog();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to rename project",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  }, [closeProjectRenameDialog, projectRenameTarget, projectRenameTitle]);

  const openProjectGroupingDialog = useCallback(
    (project: Project) => {
      const overrideKey = deriveProjectGroupingOverrideKey(project);
      setProjectGroupingTarget(project);
      setProjectGroupingSelection(
        projectGroupingSettings.sidebarProjectGroupingOverrides?.[overrideKey] ?? "inherit",
      );
    },
    [projectGroupingSettings.sidebarProjectGroupingOverrides],
  );

  const closeProjectGroupingDialog = useCallback(() => {
    setProjectGroupingTarget(null);
    setProjectGroupingSelection("inherit");
  }, []);

  const saveProjectGroupingPreference = useCallback(() => {
    if (!projectGroupingTarget) {
      return;
    }

    const overrideKey = deriveProjectGroupingOverrideKey(projectGroupingTarget);
    const nextOverrides = {
      ...projectGroupingSettings.sidebarProjectGroupingOverrides,
    };
    if (projectGroupingSelection === "inherit") {
      delete nextOverrides[overrideKey];
    } else {
      nextOverrides[overrideKey] = projectGroupingSelection;
    }
    updateSettings({
      sidebarProjectGroupingOverrides: nextOverrides,
    });
    closeProjectGroupingDialog();
  }, [
    closeProjectGroupingDialog,
    projectGroupingSelection,
    projectGroupingSettings.sidebarProjectGroupingOverrides,
    projectGroupingTarget,
    updateSettings,
  ]);

  const removeProject = useCallback(async (project: Project, options: { force?: boolean } = {}) => {
    const projectRef = scopeProjectRef(project.environmentId, project.id);
    const draftStore = useComposerDraftStore.getState();
    const projectDraftThread = draftStore.getDraftThreadByProjectRef(projectRef);
    if (projectDraftThread) {
      draftStore.clearDraftThread(projectDraftThread.draftId);
    }
    draftStore.clearProjectDraftThreadId(projectRef);

    const api = readEnvironmentApi(project.environmentId);
    if (!api) {
      throw new Error("Project API unavailable.");
    }

    await api.orchestration.dispatchCommand({
      type: "project.delete",
      commandId: newCommandId(),
      projectId: project.id,
      ...(options.force === true ? { force: true } : {}),
    });
  }, []);

  const handleRemoveProject = useCallback(
    async (project: Project) => {
      const api = readLocalApi();
      if (!api) {
        return;
      }

      const threadCount =
        threadCountByProjectKey.get(`${project.environmentId}:${project.id}`) ?? 0;
      if (threadCount > 0) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Project is not empty",
            description: "Delete all threads in this project before removing it.",
          }),
        );
        return;
      }

      const confirmed = await api.dialogs.confirm(
        [`Remove project "${project.name}"?`, `Path: ${project.cwd}`].join("\n"),
      );
      if (!confirmed) {
        return;
      }

      try {
        await removeProject(project);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Failed to remove "${project.name}"`,
            description: error instanceof Error ? error.message : "Unknown error removing project.",
          }),
        );
      }
    },
    [removeProject, threadCountByProjectKey],
  );

  const handleProjectTabContextMenu = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, project: Project) => {
      event.preventDefault();
      event.stopPropagation();

      void (async () => {
        const api = readLocalApi();
        if (!api) return;

        const actionHandlers = new Map<string, () => Promise<void> | void>([
          [
            "rename",
            () => {
              setProjectRenameTarget(project);
              setProjectRenameTitle(project.name);
            },
          ],
          ["grouping", () => openProjectGroupingDialog(project)],
          ["copy-path", () => copyPathToClipboard(project.cwd, { path: project.cwd })],
          ["delete", () => handleRemoveProject(project)],
        ]);

        const clicked = await api.contextMenu.show(
          [
            { id: "rename", label: "Rename project" },
            { id: "grouping", label: "Project grouping..." },
            { id: "copy-path", label: "Copy Project Path" },
            { id: "delete", label: "Remove project", destructive: true },
          ] satisfies ContextMenuItem<string>[],
          {
            x: event.clientX,
            y: event.clientY,
          },
        );

        if (!clicked) {
          return;
        }

        await actionHandlers.get(clicked)?.();
      })();
    },
    [copyPathToClipboard, handleRemoveProject, openProjectGroupingDialog],
  );

  const handleCreateThread = useCallback(() => {
    const targetProjectRef =
      activeProjectRef ??
      (activeThread ? scopeProjectRef(activeThread.environmentId, activeThread.projectId) : null) ??
      (activeDraftThread
        ? scopeProjectRef(activeDraftThread.environmentId, activeDraftThread.projectId)
        : null) ??
      defaultProjectRef;
    if (!targetProjectRef) {
      return;
    }

    const seedContext = resolveSidebarNewThreadSeedContext({
      projectId: targetProjectRef.projectId,
      defaultEnvMode: resolveSidebarNewThreadEnvMode({
        defaultEnvMode: defaultThreadEnvMode,
      }),
      activeThread: activeThread
        ? {
            projectId: activeThread.projectId,
            branch: activeThread.branch,
            worktreePath: activeThread.worktreePath,
          }
        : null,
      activeDraftThread: activeDraftThread
        ? {
            projectId: activeDraftThread.projectId,
            branch: activeDraftThread.branch,
            worktreePath: activeDraftThread.worktreePath,
            envMode: activeDraftThread.envMode,
          }
        : null,
    });

    void handleNewThread(targetProjectRef, {
      ...(seedContext.branch !== undefined ? { branch: seedContext.branch } : {}),
      ...(seedContext.worktreePath !== undefined ? { worktreePath: seedContext.worktreePath } : {}),
      envMode: seedContext.envMode,
    });
  }, [
    activeDraftThread,
    activeThread,
    activeProjectRef,
    defaultThreadEnvMode,
    defaultProjectRef,
    handleNewThread,
  ]);

  if (showSettingsTabs) {
    return <SettingsTopBar pathname={pathname} />;
  }

  if (!showProjectTabs) {
    return null;
  }

  return (
    <>
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
                    onKeyDown={handleTopBarTabKeyDown}
                    onContextMenu={(event) => handleProjectTabContextMenu(event, project)}
                    className={cn(
                      topBarTabBaseClassName,
                      "max-w-56",
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
            className={topBarIconButtonBaseClassName}
            aria-label="Add project"
            onClick={openAddProject}
          >
            <PlusIcon className="size-4" />
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
                  onKeyDown={handleTopBarTabKeyDown}
                  className={cn(
                    topBarTabBaseClassName,
                    "max-w-52",
                    active && "bg-surface-1 text-foreground",
                  )}
                >
                  <ThreadTabStatusIcon thread={thread} />
                  <span className="truncate">{thread.title}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className={topBarIconButtonBaseClassName}
            aria-label="New thread"
            disabled={
              !activeProjectRef && !activeThread && !activeDraftThread && !defaultProjectRef
            }
            onClick={handleCreateThread}
          >
            <SquarePenIcon className="size-4" />
          </button>
          <Link to="/settings" className={topBarIconButtonBaseClassName} aria-label="Settings">
            <SettingsIcon className="size-4" />
          </Link>
        </div>
      </div>

      <Dialog
        open={projectRenameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectRenameDialog();
          }
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              {projectRenameTarget
                ? `Update the title for ${projectRenameTarget.cwd}.`
                : "Update the project title."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Project title</span>
              <Input
                aria-label="Project title"
                value={projectRenameTitle}
                onChange={(event) => setProjectRenameTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitProjectRename();
                  }
                }}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectRenameDialog}>
              Cancel
            </Button>
            <Button onClick={() => void submitProjectRename()}>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={projectGroupingTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectGroupingDialog();
          }
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Project grouping</DialogTitle>
            <DialogDescription>
              {projectGroupingTarget
                ? `Choose how ${projectGroupingTarget.cwd} should be grouped in the sidebar.`
                : "Choose how this project should be grouped in the sidebar."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Grouping rule</span>
              <Select
                value={projectGroupingSelection}
                onValueChange={(value) => {
                  if (
                    value === "inherit" ||
                    value === "repository" ||
                    value === "repository_path" ||
                    value === "separate"
                  ) {
                    setProjectGroupingSelection(value);
                  }
                }}
              >
                <SelectTrigger className="w-full" aria-label="Project grouping rule">
                  <SelectValue>
                    {projectGroupingSelection === "inherit"
                      ? `Use global default (${PROJECT_GROUPING_MODE_LABELS[projectGroupingSettings.sidebarProjectGroupingMode]})`
                      : PROJECT_GROUPING_MODE_LABELS[projectGroupingSelection]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="inherit">
                    Use global default
                  </SelectItem>
                  <SelectItem hideIndicator value="repository">
                    {PROJECT_GROUPING_MODE_LABELS.repository}
                  </SelectItem>
                  <SelectItem hideIndicator value="repository_path">
                    {PROJECT_GROUPING_MODE_LABELS.repository_path}
                  </SelectItem>
                  <SelectItem hideIndicator value="separate">
                    {PROJECT_GROUPING_MODE_LABELS.separate}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {projectGroupingSelection === "inherit"
                ? projectGroupingModeDescription(projectGroupingSettings.sidebarProjectGroupingMode)
                : projectGroupingModeDescription(projectGroupingSelection)}
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectGroupingDialog}>
              Cancel
            </Button>
            <Button onClick={saveProjectGroupingPreference}>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
