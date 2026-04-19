import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { usePrimaryEnvironmentId } from "~/environments/primary";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "~/environments/runtime";
import { useSettings } from "~/hooks/useSettings";
import { buildSidebarProjectOrdering, type SidebarProjectSnapshot } from "~/sidebarProjects";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "~/store";
import { useUiStateStore } from "~/uiStateStore";

export function useSettingsSidebarProjects(): readonly SidebarProjectSnapshot[] {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const projectOrder = useUiStateStore((state) => state.projectOrder);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((state) => state.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((state) => state.byId);
  const sidebarProjectSortOrder = useSettings((settings) => settings.sidebarProjectSortOrder);

  return useMemo(
    () =>
      buildSidebarProjectOrdering({
        projects,
        sidebarThreads,
        preferredProjectKeys: projectOrder,
        primaryEnvironmentId,
        savedEnvironmentRegistryById: savedEnvironmentRegistry,
        savedEnvironmentRuntimeById,
        sortOrder: sidebarProjectSortOrder,
      }).sortedProjects,
    [
      primaryEnvironmentId,
      projectOrder,
      projects,
      savedEnvironmentRegistry,
      savedEnvironmentRuntimeById,
      sidebarProjectSortOrder,
      sidebarThreads,
    ],
  );
}
