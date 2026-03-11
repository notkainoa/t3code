import { describe, expect, it } from "vitest";

import {
  hasUnseenCompletion,
  isReusableDraftResettable,
  resolveReusedDraftContextForNewThread,
  resolveThreadStatusPill,
} from "./Sidebar.logic";

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): Parameters<typeof hasUnseenCompletion>[0]["latestTurn"] {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-09T10:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        proposedPlans: [],
        session: null,
      }),
    ).toBe(true);
  });
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    proposedPlans: [],
    session: {
      provider: "codex" as const,
      status: "running" as const,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      orchestrationStatus: "running" as const,
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the thread is actively running without blockers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });
});

describe("resolveReusedDraftContextForNewThread", () => {
  it("treats a pristine local blank draft as resettable", () => {
    expect(
      isReusableDraftResettable({
        hasComposerDraftContent: false,
        draftThread: {
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      }),
    ).toBe(true);
  });

  it("does not reset a draft with only branch setup", () => {
    expect(
      isReusableDraftResettable({
        hasComposerDraftContent: false,
        draftThread: {
          branch: "feature/base",
          worktreePath: null,
          envMode: "local",
        },
      }),
    ).toBe(false);
  });

  it("does not reset a draft with explicit worktree mode before worktree creation", () => {
    expect(
      isReusableDraftResettable({
        hasComposerDraftContent: false,
        draftThread: {
          branch: null,
          worktreePath: null,
          envMode: "worktree",
        },
      }),
    ).toBe(false);
  });

  it("does not reset a draft that already has composer content", () => {
    expect(
      isReusableDraftResettable({
        hasComposerDraftContent: true,
        draftThread: {
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      }),
    ).toBe(false);
  });

  it("resets a reusable blank draft to the current default env mode", () => {
    expect(
      resolveReusedDraftContextForNewThread({
        defaultNewThreadEnvMode: "worktree",
        isReusableDraftResettable: true,
      }),
    ).toEqual({
      branch: null,
      worktreePath: null,
      envMode: "worktree",
    });
  });

  it("preserves a non-empty reused draft when no explicit override is requested", () => {
    expect(
      resolveReusedDraftContextForNewThread({
        defaultNewThreadEnvMode: "worktree",
        isReusableDraftResettable: false,
      }),
    ).toBeNull();
  });

  it("keeps explicit new-thread overrides instead of replacing them with defaults", () => {
    expect(
      resolveReusedDraftContextForNewThread({
        options: {
          branch: "feature/test",
          worktreePath: null,
          envMode: "local",
        },
        defaultNewThreadEnvMode: "worktree",
        isReusableDraftResettable: true,
      }),
    ).toEqual({
      branch: "feature/test",
      worktreePath: null,
      envMode: "local",
    });
  });

  it("uses explicit local overrides to clear stale branch metadata", () => {
    expect(
      resolveReusedDraftContextForNewThread({
        options: {
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
        defaultNewThreadEnvMode: "worktree",
        isReusableDraftResettable: false,
      }),
    ).toEqual({
      branch: null,
      worktreePath: null,
      envMode: "local",
    });
  });
});
