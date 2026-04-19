import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import type { SidebarProjectSortOrder } from "@t3tools/contracts/settings";

import type { SavedEnvironmentRecord, SavedEnvironmentRuntimeState } from "./environments/runtime";
import { deriveLogicalProjectKey } from "./logicalProject";
import type { Project, SidebarThreadSummary } from "./types";
import { orderItemsByPreferredIds, sortProjectsForSidebar } from "./components/Sidebar.logic";

export type EnvironmentPresence = "local-only" | "remote-only" | "mixed";

export type SidebarProjectSnapshot = Project & {
  projectKey: string;
  environmentPresence: EnvironmentPresence;
  memberProjectRefs: readonly ScopedProjectRef[];
  remoteEnvironmentLabels: readonly string[];
};

export interface SidebarProjectOrdering {
  readonly orderedProjects: readonly Project[];
  readonly physicalToLogicalKey: ReadonlyMap<string, string>;
  readonly sidebarProjects: readonly SidebarProjectSnapshot[];
  readonly sortedProjects: readonly SidebarProjectSnapshot[];
}

export function buildSidebarProjectOrdering(input: {
  readonly projects: readonly Project[];
  readonly sidebarThreads: readonly SidebarThreadSummary[];
  readonly preferredProjectKeys: readonly string[];
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly savedEnvironmentRegistryById: Record<EnvironmentId, SavedEnvironmentRecord>;
  readonly savedEnvironmentRuntimeById: Record<EnvironmentId, SavedEnvironmentRuntimeState>;
  readonly sortOrder: SidebarProjectSortOrder;
}): SidebarProjectOrdering {
  const orderedProjects = orderItemsByPreferredIds({
    items: input.projects,
    preferredIds: input.preferredProjectKeys,
    getId: (project) => scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
  });

  const physicalToLogicalKey = new Map<string, string>();
  for (const project of orderedProjects) {
    const physicalKey = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
    physicalToLogicalKey.set(physicalKey, deriveLogicalProjectKey(project));
  }

  const groupedMembers = new Map<string, Project[]>();
  for (const project of orderedProjects) {
    const logicalKey = deriveLogicalProjectKey(project);
    const existing = groupedMembers.get(logicalKey);
    if (existing) {
      existing.push(project);
    } else {
      groupedMembers.set(logicalKey, [project]);
    }
  }

  const sidebarProjects: SidebarProjectSnapshot[] = [];
  const seen = new Set<string>();
  for (const project of orderedProjects) {
    const logicalKey = deriveLogicalProjectKey(project);
    if (seen.has(logicalKey)) continue;
    seen.add(logicalKey);

    const members = groupedMembers.get(logicalKey) ?? [];
    const representative =
      (input.primaryEnvironmentId
        ? members.find((member) => member.environmentId === input.primaryEnvironmentId)
        : undefined) ?? members[0];
    if (!representative) continue;

    const hasLocal =
      input.primaryEnvironmentId !== null &&
      members.some((member) => member.environmentId === input.primaryEnvironmentId);
    const hasRemote =
      input.primaryEnvironmentId !== null &&
      members.some((member) => member.environmentId !== input.primaryEnvironmentId);

    sidebarProjects.push({
      ...representative,
      projectKey: logicalKey,
      environmentPresence:
        hasLocal && hasRemote ? "mixed" : hasRemote ? "remote-only" : "local-only",
      memberProjectRefs: members.map((member) => scopeProjectRef(member.environmentId, member.id)),
      remoteEnvironmentLabels: members
        .filter(
          (member) =>
            input.primaryEnvironmentId !== null &&
            member.environmentId !== input.primaryEnvironmentId,
        )
        .map((member) => {
          const runtime = input.savedEnvironmentRuntimeById[member.environmentId];
          const saved = input.savedEnvironmentRegistryById[member.environmentId];
          return runtime?.descriptor?.label ?? saved?.label ?? member.environmentId;
        }),
    });
  }

  const sidebarProjectByKey = new Map(
    sidebarProjects.map((project) => [project.projectKey, project] as const),
  );
  const visibleThreads = input.sidebarThreads.filter((thread) => thread.archivedAt === null);
  const sortableProjects = sidebarProjects.map((project) => ({
    ...project,
    id: project.projectKey,
  }));
  const sortableThreads = visibleThreads.map((thread) => {
    const physicalKey = scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
    return {
      id: thread.id,
      environmentId: thread.environmentId,
      projectId: (physicalToLogicalKey.get(physicalKey) ?? physicalKey) as ProjectId,
      title: thread.title,
      interactionMode: thread.interactionMode,
      session: thread.session,
      createdAt: thread.createdAt,
      archivedAt: thread.archivedAt,
      updatedAt: thread.updatedAt,
      latestTurn: thread.latestTurn,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      latestUserMessageAt: thread.latestUserMessageAt,
      hasPendingApprovals: thread.hasPendingApprovals,
      hasPendingUserInput: thread.hasPendingUserInput,
      hasActionableProposedPlan: thread.hasActionableProposedPlan,
    };
  });
  const sortedProjects = sortProjectsForSidebar(
    sortableProjects,
    sortableThreads,
    input.sortOrder,
  ).flatMap((project) => {
    const resolved = sidebarProjectByKey.get(project.id);
    return resolved ? [resolved] : [];
  });

  return {
    orderedProjects,
    physicalToLogicalKey,
    sidebarProjects,
    sortedProjects,
  };
}
