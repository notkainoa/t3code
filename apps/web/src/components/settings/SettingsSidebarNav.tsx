import type { ComponentType, DragEvent } from "react";
import { useMemo, useState } from "react";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BlocksIcon,
  Link2Icon,
  Settings2Icon,
  ZapIcon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { useExtensionManagerStore } from "~/extensionManagerStore";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import { cn } from "~/lib/utils";
import { toastManager } from "~/components/ui/toast";

import { buildProjectRoute, EXTENSION_DRAG_MIME } from "./ExtensionManager";
import { useSettingsSidebarProjects } from "./useSettingsSidebarProjects";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "../ui/sidebar";

type SettingsStaticPath =
  | "/settings/general"
  | "/settings/connections"
  | "/settings/archived"
  | "/settings/extensions/skills"
  | "/settings/extensions/plugins";

type SettingsStaticGroup = {
  readonly label: string;
  readonly items: ReadonlyArray<{
    readonly label: string;
    readonly to: SettingsStaticPath;
    readonly icon: ComponentType<{ className?: string }>;
  }>;
};

const SETTINGS_NAV_GROUPS: readonly SettingsStaticGroup[] = [
  {
    label: "App",
    items: [
      { label: "General", to: "/settings/general", icon: Settings2Icon },
      { label: "Connections", to: "/settings/connections", icon: Link2Icon },
      { label: "Archive", to: "/settings/archived", icon: ArchiveIcon },
    ],
  },
  {
    label: "Extensions",
    items: [
      { label: "Skills", to: "/settings/extensions/skills", icon: ZapIcon },
      { label: "Plugins", to: "/settings/extensions/plugins", icon: BlocksIcon },
    ],
  },
] as const;

function eventHasExtensionDrag(event: Pick<DragEvent<HTMLElement>, "dataTransfer">): boolean {
  return Array.from(event.dataTransfer.types).includes(EXTENSION_DRAG_MIME);
}

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const projects = useSettingsSidebarProjects();
  const draggingExtensionId = useExtensionManagerStore((state) => state.draggingExtensionId);
  const assignToProject = useExtensionManagerStore((state) => state.assignToProject);
  const projectInstallIdsByProjectKey = useExtensionManagerStore(
    (state) => state.projectInstallIdsByProjectKey,
  );
  const [dragOverProjectKey, setDragOverProjectKey] = useState<string | null>(null);

  const projectCountsByKey = useMemo(
    () =>
      Object.fromEntries(
        projects.map((project) => [
          project.projectKey,
          projectInstallIdsByProjectKey[project.projectKey]?.length ?? 0,
        ]),
      ),
    [projectInstallIdsByProjectKey, projects],
  );

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        {SETTINGS_NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="px-2 py-2">
            <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {group.label}
              </span>
            </div>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.to;
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      size="sm"
                      isActive={isActive}
                      className={cn(
                        "gap-2.5 px-2.5 py-2 text-left text-[13px]",
                        isActive
                          ? "font-medium text-foreground"
                          : "text-muted-foreground/70 hover:text-foreground/80",
                      )}
                      onClick={() => void navigate({ to: item.to, replace: true })}
                    >
                      <Icon
                        className={cn(
                          "size-4 shrink-0",
                          isActive ? "text-foreground" : "text-muted-foreground/60",
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}

        <SidebarSeparator />

        <SidebarGroup className="px-2 py-2">
          <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Projects
            </span>
            {draggingExtensionId ? (
              <span className="text-[10px] font-medium uppercase tracking-wider text-amber-500/80">
                Drop target
              </span>
            ) : null}
          </div>
          <SidebarMenu>
            {projects.map((project) => {
              const route = buildProjectRoute(project);
              const isActive =
                pathname ===
                `/settings/projects/${route.params.environmentId}/${route.params.projectId}`;
              const assignmentCount = projectCountsByKey[project.projectKey] ?? 0;
              const isDropTarget = dragOverProjectKey === project.projectKey;

              return (
                <SidebarMenuItem key={project.projectKey}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={isActive}
                    className={cn(
                      "gap-2 px-2 py-1.5 text-left",
                      isDropTarget &&
                        "border border-amber-400/35 bg-amber-500/10 text-foreground shadow-[0_0_0_1px_rgba(251,191,36,0.18)]",
                    )}
                    onClick={() => void navigate(route)}
                    onDragEnter={(event) => {
                      if (!eventHasExtensionDrag(event)) {
                        return;
                      }
                      setDragOverProjectKey(project.projectKey);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDragOverProjectKey((current) =>
                          current === project.projectKey ? null : current,
                        );
                      }
                    }}
                    onDragOver={(event) => {
                      if (!eventHasExtensionDrag(event)) {
                        return;
                      }
                      event.preventDefault();
                      setDragOverProjectKey(project.projectKey);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const extensionId = event.dataTransfer.getData(EXTENSION_DRAG_MIME);
                      if (!extensionId) {
                        setDragOverProjectKey(null);
                        return;
                      }
                      assignToProject(extensionId, project.projectKey);
                      useExtensionManagerStore.getState().setDraggingExtensionId(null);
                      setDragOverProjectKey(null);
                      void navigate(route);
                      toastManager.add({
                        type: "success",
                        title: "Extension assigned",
                        description: `Added to ${project.name}.`,
                      });
                    }}
                  >
                    <div className="flex size-4 shrink-0 items-center justify-center">
                      <ProjectFavicon cwd={project.cwd} environmentId={project.environmentId} />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-xs">{project.name}</span>
                    {assignmentCount > 0 ? (
                      <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {assignmentCount}
                      </span>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              className="gap-2 px-2 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => window.history.back()}
            >
              <ArrowLeftIcon className="size-4" />
              <span>Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
