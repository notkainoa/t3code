import { createFileRoute } from "@tanstack/react-router";
import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { KanbanBoard } from "../components/KanbanBoard";
import { NoActiveThreadState } from "../components/NoActiveThreadState";
import { ProjectFavicon } from "../components/ProjectFavicon";
import { Button } from "../components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuTrigger,
} from "../components/ui/menu";
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

function KanbanViewSettingsMenu({
  todoColumnVisible,
  onTodoColumnVisibleChange,
}: {
  todoColumnVisible: boolean;
  onTodoColumnVisibleChange: (visible: boolean) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="outline" size="xs" />}
        className="h-7 shrink-0 px-2 text-muted-foreground hover:text-foreground"
        aria-label={`Customize board view. Backlog column ${
          todoColumnVisible ? "shown" : "hidden"
        }.`}
        title="Customize board view"
      >
        <SlidersHorizontalIcon className="size-3.5" />
        <span className="hidden sm:inline">View</span>
        {!todoColumnVisible ? (
          <span className="hidden rounded-sm border border-border/70 bg-muted/65 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground sm:inline-flex">
            Backlog hidden
          </span>
        ) : null}
        <ChevronDownIcon className="size-3 opacity-55" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-64">
        <MenuGroup>
          <MenuGroupLabel>Customize board</MenuGroupLabel>
          <MenuCheckboxItem
            checked={todoColumnVisible}
            className="min-h-11 py-2"
            variant="switch"
            onCheckedChange={onTodoColumnVisibleChange}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">Backlog column</span>
              <span className="text-xs text-muted-foreground/70">
                Show backlog tasks on the board
              </span>
            </span>
          </MenuCheckboxItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function ChatProjectRouteView() {
  const search = Route.useSearch();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const kanbanTodoColumnVisible = useUiStateStore((store) => store.kanbanTodoColumnVisible);
  const setKanbanTodoColumnVisible = useUiStateStore((store) => store.setKanbanTodoColumnVisible);
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
          <KanbanViewSettingsMenu
            todoColumnVisible={kanbanTodoColumnVisible}
            onTodoColumnVisibleChange={setKanbanTodoColumnVisible}
          />
        </header>
        <KanbanBoard
          project={project}
          threads={threads}
          todoColumnVisible={kanbanTodoColumnVisible}
        />
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
