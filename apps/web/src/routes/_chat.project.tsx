import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { KanbanBoard } from "../components/KanbanBoard";
import { NoActiveThreadState } from "../components/NoActiveThreadState";
import { ProjectFavicon } from "../components/ProjectFavicon";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { usePrimaryEnvironmentId } from "../environments/primary";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { useSettings } from "../hooks/useSettings";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsForProjectRefs,
  useStore,
} from "../store";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import { useUiStateStore } from "../uiStateStore";

type ProjectRouteSearch = {
  projectKey?: string | undefined;
};

function ChatProjectRouteView() {
  const search = Route.useSearch();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const projectGroupingSettings = useSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((store) => store.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((store) => store.byId);

  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
      }),
    [projectOrder, projects],
  );

  const sidebarProjects = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: orderedProjects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => {
          const rt = savedEnvironmentRuntimeById[environmentId];
          const saved = savedEnvironmentRegistry[environmentId];
          return rt?.descriptor?.label ?? saved?.label ?? null;
        },
      }),
    [
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      savedEnvironmentRegistry,
      savedEnvironmentRuntimeById,
    ],
  );

  const project = useMemo(
    () => sidebarProjects.find((candidate) => candidate.projectKey === search.projectKey) ?? null,
    [search.projectKey, sidebarProjects],
  );
  const threads = useStore(
    useShallow((state) =>
      project ? selectSidebarThreadsForProjectRefs(state, project.memberProjectRefs) : [],
    ),
  );

  if (!project) {
    return <NoActiveThreadState />;
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="flex shrink-0 items-center gap-3 border-b border-border pb-2 pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)] pt-2 sm:pb-3 sm:pl-[calc(env(safe-area-inset-left)+1.25rem)] sm:pr-[calc(env(safe-area-inset-right)+1.25rem)] sm:pt-3">
          <SidebarTrigger className="size-7 shrink-0 md:hidden" />
          <ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-foreground/90">
              {project.displayName}
            </h1>
          </div>
        </header>
        <KanbanBoard project={project} threads={threads} />
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/project")({
  validateSearch: (search): ProjectRouteSearch => ({
    projectKey: typeof search.projectKey === "string" ? search.projectKey : undefined,
  }),
  component: ChatProjectRouteView,
});
