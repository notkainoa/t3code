import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime";
import { describe, expect, it } from "vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  type OrchestrationLatestTurn,
} from "@t3tools/contracts";
import { buildThreadSections } from "./threadSections";
import type { SidebarThreadSummary } from "./types";

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-1");

function makeLatestTurn(completedAt = "2026-03-09T10:05:00.000Z"): OrchestrationLatestTurn {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: "2026-03-09T10:00:00.000Z",
    completedAt,
  };
}

function makeThread(
  id: string,
  overrides: Partial<SidebarThreadSummary> = {},
): SidebarThreadSummary {
  return {
    id: ThreadId.make(id),
    environmentId,
    projectId,
    title: id,
    interactionMode: "default",
    session: null,
    createdAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

describe("buildThreadSections", () => {
  it("funnels thread statuses into the kanban columns", () => {
    const sections = buildThreadSections({
      threads: [
        makeThread("plan-ready", {
          interactionMode: "plan",
          latestTurn: makeLatestTurn(),
          hasActionableProposedPlan: true,
          session: {
            provider: ProviderDriverKind.make("codex"),
            status: "ready",
            createdAt: "2026-03-09T10:00:00.000Z",
            updatedAt: "2026-03-09T10:00:00.000Z",
            orchestrationStatus: "ready",
          },
        }),
        makeThread("in-progress", {
          session: {
            provider: ProviderDriverKind.make("codex"),
            status: "running",
            createdAt: "2026-03-09T10:00:00.000Z",
            updatedAt: "2026-03-09T10:00:00.000Z",
            orchestrationStatus: "running",
          },
        }),
        makeThread("needs-input", {
          hasPendingApprovals: true,
          hasPendingUserInput: true,
        }),
        makeThread("unread", {
          latestTurn: makeLatestTurn(),
        }),
        makeThread("done"),
      ],
      lastVisitedAtByThreadKey: new Map([
        [
          scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make("plan-ready"))),
          "2026-03-09T10:06:00.000Z",
        ],
        [
          scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make("unread"))),
          "2026-03-09T10:04:00.000Z",
        ],
      ]),
      sortOrder: "created_at",
    }).sections;

    expect(sections.map((section) => [section.id, section.label])).toEqual([
      ["todo", "Backlog"],
      ["in-progress", "In Progress"],
      ["needs-input", "Needs Input"],
      ["unread", "Unread"],
      ["done", "Done"],
    ]);
    expect(sections.map((section) => section.threads.map((thread) => thread.title))).toEqual([
      [],
      ["in-progress"],
      ["plan-ready", "needs-input"],
      ["unread"],
      ["done"],
    ]);
  });

  it("prioritizes unread over plan-ready when the latest completion has not been seen", () => {
    const sections = buildThreadSections({
      threads: [
        makeThread("plan-unread", {
          interactionMode: "plan",
          latestTurn: makeLatestTurn(),
          hasActionableProposedPlan: true,
          session: {
            provider: ProviderDriverKind.make("codex"),
            status: "ready",
            createdAt: "2026-03-09T10:00:00.000Z",
            updatedAt: "2026-03-09T10:00:00.000Z",
            orchestrationStatus: "ready",
          },
        }),
      ],
      lastVisitedAtByThreadKey: new Map([
        [
          scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make("plan-unread"))),
          "2026-03-09T10:04:00.000Z",
        ],
      ]),
      sortOrder: "created_at",
    }).sections;

    expect(sections.find((section) => section.id === "todo")?.threads).toEqual([]);
    expect(
      sections.find((section) => section.id === "unread")?.threads.map((thread) => thread.id),
    ).toEqual([ThreadId.make("plan-unread")]);
  });
});
